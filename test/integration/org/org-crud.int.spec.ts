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
 * Organization-level write gates (PATCH / DELETE):
 *  - both route through `AuthorizationService.assertCanManageOrganization`
 *    (OWNER-only) → STAFF and BRANCH_MANAGER are denied with 403;
 *  - a caller whose token is scoped to a *different* org is denied (the
 *    role check resolves against the path org and finds no managing role).
 */
describe('Organizations — CRUD auth gates (integration)', () => {
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

  /** Mint an access token for a profile (avoids HTTP-login throttle bleed). */
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

  it('OWNER can PATCH the organization', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const auth = await authFor(a.ownerProfileId, a.org.id);

    const res = await auth(
      request(http()).patch(`/v1/organizations/${a.org.id}`),
    )
      .send({ name: 'Renamed Clinic A' })
      .expect(200);

    expect(res.body.data.name).toBe('Renamed Clinic A');
  });

  it('STAFF cannot PATCH the organization (403)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const staff = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: `staff-${randomUUID()}@x.com`,
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const auth = await authFor(staff.profileId, a.org.id);

    await auth(request(http()).patch(`/v1/organizations/${a.org.id}`))
      .send({ name: 'Nope' })
      .expect(403);
  });

  it('BRANCH_MANAGER cannot PATCH the organization (org-manage is OWNER-only) (403)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const bm = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: `bm-${randomUUID()}@x.com`,
      roleCode: 'BRANCH_MANAGER',
      assignToBranch: true,
    });
    const auth = await authFor(bm.profileId, a.org.id);

    await auth(request(http()).patch(`/v1/organizations/${a.org.id}`))
      .send({ name: 'Nope' })
      .expect(403);
  });

  it('OWNER can DELETE the organization', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const auth = await authFor(a.ownerProfileId, a.org.id);

    await auth(request(http()).delete(`/v1/organizations/${a.org.id}`)).expect(
      204,
    );
  });

  it('a caller from another org cannot PATCH or DELETE this org (403)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-a-${randomUUID()}@x.com`);
    const b = await seedOrg(prisma, 'Clinic B', `owner-b-${randomUUID()}@x.com`);
    // Owner of B, token scoped to B, attempting to act on A.
    const authB = await authFor(b.ownerProfileId, b.org.id);

    await authB(request(http()).patch(`/v1/organizations/${a.org.id}`))
      .send({ name: 'Cross-tenant' })
      .expect(403);
    await authB(
      request(http()).delete(`/v1/organizations/${a.org.id}`),
    ).expect(403);
  });
});
