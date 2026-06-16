import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';
import {
  bearer,
  loginAndSelect,
  roleIdByCode,
  seedMember,
  signupOwner,
} from '../../helpers/auth-helpers';

/**
 * Privilege-escalation guards on the invitation write path:
 *  - non-managers (STAFF) cannot invite at all (assertCanManageStaff);
 *  - a BRANCH_MANAGER cannot grant OWNER / BRANCH_MANAGER via an invitation
 *    (assertNoPrivilegedRoleAssignment) — only an OWNER can.
 * Positive controls prove the blocks are role-specific, not blanket denials.
 */
describe('Auth — privilege escalation via invitations (integration)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let prisma: PrismaClient;

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

  const inviteBody = (roleIds: string[], branchId: string) => ({
    email: `invitee-${randomUUID()}@example.com`,
    first_name: 'New',
    last_name: 'Hire',
    role_id: roleIds[0],
    branch_ids: [branchId],
  });

  it('a STAFF member cannot create any invitation (403)', async () => {
    const owner = await signupOwner(app, mailMock);
    const staffRoleId = await roleIdByCode(prisma, 'STAFF');
    const staffEmail = `staff-${randomUUID()}@example.com`;
    await seedMember(prisma, {
      orgId: owner.orgId,
      branchId: owner.branchId,
      email: staffEmail,
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const staff = await loginAndSelect(app, staffEmail);

    await bearer(staff.accessToken)(
      request(app.getHttpServer()).post(
        `/v1/organizations/${owner.orgId}/branches/${owner.branchId}/invitations`,
      ),
    )
      .send(inviteBody([staffRoleId], owner.branchId))
      .expect(403);
  });

  it('a BRANCH_MANAGER cannot grant OWNER or BRANCH_MANAGER, but can invite a plain STAFF', async () => {
    const owner = await signupOwner(app, mailMock);
    const [staffRoleId, ownerRoleId, bmRoleId] = await Promise.all([
      roleIdByCode(prisma, 'STAFF'),
      roleIdByCode(prisma, 'OWNER'),
      roleIdByCode(prisma, 'BRANCH_MANAGER'),
    ]);
    const bmEmail = `bm-${randomUUID()}@example.com`;
    await seedMember(prisma, {
      orgId: owner.orgId,
      branchId: owner.branchId,
      email: bmEmail,
      roleCode: 'BRANCH_MANAGER',
      assignToBranch: true,
    });
    const bm = await loginAndSelect(app, bmEmail);
    const authBm = bearer(bm.accessToken);
    const url = `/v1/organizations/${owner.orgId}/branches/${owner.branchId}/invitations`;

    // Escalation attempts → 403.
    await authBm(request(app.getHttpServer()).post(url))
      .send(inviteBody([ownerRoleId], owner.branchId))
      .expect(403);
    await authBm(request(app.getHttpServer()).post(url))
      .send(inviteBody([bmRoleId], owner.branchId))
      .expect(403);

    // Plain STAFF invitation on its own branch → allowed.
    await authBm(request(app.getHttpServer()).post(url))
      .send(inviteBody([staffRoleId], owner.branchId))
      .expect(201);
  });

  it('an OWNER may grant a privileged (BRANCH_MANAGER) role via invitation', async () => {
    const owner = await signupOwner(app, mailMock);
    const bmRoleId = await roleIdByCode(prisma, 'BRANCH_MANAGER');

    await bearer(owner.accessToken)(
      request(app.getHttpServer()).post(
        `/v1/organizations/${owner.orgId}/branches/${owner.branchId}/invitations`,
      ),
    )
      .send(inviteBody([bmRoleId], owner.branchId))
      .expect(201);
  });
});
