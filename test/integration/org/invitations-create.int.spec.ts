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
import { bearer, roleIdByCode, seedMember } from '../../helpers/auth-helpers';
import { seedOrg } from '../../helpers/financial-helpers';

/**
 * Single-create invitation gate (`POST .../branches/:branchId/invitations`):
 *  - a non-OWNER (BRANCH_MANAGER) inviting an OWNER/BRANCH_MANAGER role is
 *    blocked by `assertNoPrivilegedRoleAssignment` (403);
 *  - an OWNER inviting a plain STAFF succeeds (201);
 *  - a cross-org caller is denied. (Accept flow is covered separately.)
 */
describe('Invitations — create gate (integration)', () => {
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

  const inviteBody = (roleId: string, branchId: string) => ({
    email: `invitee-${randomUUID()}@example.com`,
    first_name: 'New',
    last_name: 'Hire',
    role_id: roleId,
    branch_ids: [branchId],
  });

  it('an OWNER may invite a plain STAFF member (201)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const staffRoleId = await roleIdByCode(prisma, 'STAFF');
    const auth = await authFor(a.ownerProfileId, a.org.id);
    const url = `/v1/organizations/${a.org.id}/branches/${a.branch.id}/invitations`;

    await auth(request(http()).post(url))
      .send(inviteBody(staffRoleId, a.branch.id))
      .expect(201);
  });

  it('a BRANCH_MANAGER cannot invite an OWNER or BRANCH_MANAGER role (403), but can invite STAFF (201)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const [staffRoleId, ownerRoleId, bmRoleId] = await Promise.all([
      roleIdByCode(prisma, 'STAFF'),
      roleIdByCode(prisma, 'OWNER'),
      roleIdByCode(prisma, 'BRANCH_MANAGER'),
    ]);
    const bm = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: `bm-${randomUUID()}@x.com`,
      roleCode: 'BRANCH_MANAGER',
      assignToBranch: true,
    });
    const auth = await authFor(bm.profileId, a.org.id);
    const url = `/v1/organizations/${a.org.id}/branches/${a.branch.id}/invitations`;

    await auth(request(http()).post(url))
      .send(inviteBody(ownerRoleId, a.branch.id))
      .expect(403);
    await auth(request(http()).post(url))
      .send(inviteBody(bmRoleId, a.branch.id))
      .expect(403);
    await auth(request(http()).post(url))
      .send(inviteBody(staffRoleId, a.branch.id))
      .expect(201);
  });

  it('a cross-org caller cannot invite into this org (403)', async () => {
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
    const staffRoleId = await roleIdByCode(prisma, 'STAFF');
    const authB = await authFor(b.ownerProfileId, b.org.id);
    const url = `/v1/organizations/${a.org.id}/branches/${a.branch.id}/invitations`;

    await authB(request(http()).post(url))
      .send(inviteBody(staffRoleId, a.branch.id))
      .expect(403);
  });
});
