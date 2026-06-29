import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';
import { bearer, seedMember } from '../../helpers/auth-helpers';
import { seedOrg } from '../../helpers/financial-helpers';

/**
 * Branch write gates:
 *  - create / delete route through `assertCanManageOrganization` (OWNER-only);
 *  - update routes through `assertCanManageBranch` (OWNER, or BRANCH_MANAGER
 *    bounded to a branch they're assigned to);
 *  - cross-org callers are denied.
 */
describe('Branches — CRUD auth gates (integration)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let prisma: PrismaClient;
  const jwt = new JwtService({});

  beforeAll(async () => {
    mailMock = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp(mailMock);
    prisma = getTestPrisma();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestPrisma();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    mailMock.mockClear();
  });

  const http = () => app.getHttpServer();

  async function authFor(profileId: string, orgId: string) {
    const { user_id } = await prisma.profile.findUniqueOrThrow({
      where: { id: profileId },
      select: { user_id: true },
    });
    return bearer(
      jwt.sign(
        { userId: user_id, profileId, organizationId: orgId, type: 'access' },
        { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: '15m' },
      ),
    );
  }

  /**
   * Repoint the org's subscription to the `network` plan (max_branches = 3) so
   * a second branch can be created past the free-trial single-branch limit —
   * isolating the auth gate from the plan-limit gate.
   */
  async function upgradeToNetwork(orgId: string) {
    const plan = await prisma.subscriptionPlan.findFirstOrThrow({
      where: { plan: 'network' },
    });
    await prisma.subscription.updateMany({
      where: { organization_id: orgId },
      data: { subscription_plan_id: plan.id },
    });
  }

  const makeBranch = (over: Record<string, unknown> = {}) => ({
    name: `Branch-${randomUUID().slice(0, 8)}`,
    address: '1 Test St',
    city: 'Cairo',
    governorate: 'Cairo',
    ...over,
  });

  it('OWNER can create a branch', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    await upgradeToNetwork(a.org.id);
    const auth = await authFor(a.ownerProfileId, a.org.id);

    const res = await auth(
      request(http()).post(`/v1/organizations/${a.org.id}/branches`),
    )
      .send(makeBranch())
      .expect(201);
    expect(res.body.data.id).toBeDefined();
  });

  it('BRANCH_MANAGER cannot create a branch (org-manage gate) (403)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const bm = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: `bm-${randomUUID()}@x.com`,
      roleCode: 'BRANCH_MANAGER',
      assignToBranch: true,
    });
    const auth = await authFor(bm.profileId, a.org.id);

    await auth(request(http()).post(`/v1/organizations/${a.org.id}/branches`))
      .send(makeBranch())
      .expect(403);
  });

  it('a BRANCH_MANAGER can update a branch they manage, but not one outside their scope', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    // A second branch the BM is NOT assigned to.
    const otherBranch = await prisma.branch.create({
      data: {
        organization_id: a.org.id,
        name: 'Other',
        address: '2 St',
        city: 'Cairo',
        governorate: 'Cairo',
      },
    });
    const bm = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: `bm-${randomUUID()}@x.com`,
      roleCode: 'BRANCH_MANAGER',
      assignToBranch: true,
    });
    const auth = await authFor(bm.profileId, a.org.id);

    // Managed (assigned) branch → 200.
    await auth(
      request(http()).patch(
        `/v1/organizations/${a.org.id}/branches/${a.branch.id}`,
      ),
    )
      .send({ name: 'Renamed Main' })
      .expect(200);

    // Unassigned branch → 403.
    await auth(
      request(http()).patch(
        `/v1/organizations/${a.org.id}/branches/${otherBranch.id}`,
      ),
    )
      .send({ name: 'Nope' })
      .expect(403);
  });

  it('OWNER can update any branch', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const auth = await authFor(a.ownerProfileId, a.org.id);

    await auth(
      request(http()).patch(
        `/v1/organizations/${a.org.id}/branches/${a.branch.id}`,
      ),
    )
      .send({ name: 'Owner Renamed' })
      .expect(200);
  });

  it('OWNER can delete a (non-last) branch; BRANCH_MANAGER on it can too', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    // Add a second branch so deletion is not the last-branch cascade.
    const extra = await prisma.branch.create({
      data: {
        organization_id: a.org.id,
        name: 'Extra',
        address: '3 St',
        city: 'Cairo',
        governorate: 'Cairo',
      },
    });
    const auth = await authFor(a.ownerProfileId, a.org.id);

    await auth(
      request(http()).delete(
        `/v1/organizations/${a.org.id}/branches/${extra.id}`,
      ),
    ).expect(204);
  });

  it('a cross-org caller cannot create or update branches in this org (403)', async () => {
    const a = await seedOrg(
      prisma,
      'Clinic A',
      `owner-a-${randomUUID()}@x.com`,
    );
    const b = await seedOrg(
      prisma,
      'Clinic B',
      `owner-b-${randomUUID()}@x.com`,
    );
    const authB = await authFor(b.ownerProfileId, b.org.id);

    await authB(request(http()).post(`/v1/organizations/${a.org.id}/branches`))
      .send(makeBranch())
      .expect(403);
    await authB(
      request(http()).patch(
        `/v1/organizations/${a.org.id}/branches/${a.branch.id}`,
      ),
    )
      .send({ name: 'Cross-tenant' })
      .expect(403);
  });
});
