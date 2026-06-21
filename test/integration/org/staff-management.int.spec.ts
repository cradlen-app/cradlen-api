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
 * Staff-management write gates on `organizations/:orgId/branches/:branchId/staff`:
 *  - the controller PermissionGuard requires `staff.manage` (OWNER/BRANCH_MANAGER)
 *    → a plain STAFF caller is rejected (403) before the service runs;
 *  - the service-layer `assertNoPrivilegedRoleAssignment` blocks a BRANCH_MANAGER
 *    from creating/updating a staff member with an OWNER/BRANCH_MANAGER role —
 *    only an OWNER may grant privileged roles;
 *  - DELETE (remove-from-branch) is OWNER + BRANCH_MANAGER (on their branch).
 */
describe('Staff management — privileged-role + permission gates (integration)', () => {
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

  const staffBody = (roleId: string, branchId: string) => ({
    first_name: 'New',
    last_name: 'Hire',
    phone_number: `+2010${Math.floor(Math.random() * 1e8)}`,
    password: 'Password1!',
    role_id: roleId,
    branch_ids: [branchId],
  });

  it('a STAFF caller is rejected by the permission guard when creating staff (403)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const staffRoleId = await roleIdByCode(prisma, 'STAFF');
    const caller = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: `staff-${randomUUID()}@x.com`,
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const auth = await authFor(caller.profileId, a.org.id);
    const url = `/v1/organizations/${a.org.id}/branches/${a.branch.id}/staff`;

    await auth(request(http()).post(url))
      .send(staffBody(staffRoleId, a.branch.id))
      .expect(403);
  });

  it('a BRANCH_MANAGER cannot create a staff member with a privileged role (403)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const [ownerRoleId, bmRoleId] = await Promise.all([
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
    const url = `/v1/organizations/${a.org.id}/branches/${a.branch.id}/staff`;

    await auth(request(http()).post(url))
      .send(staffBody(ownerRoleId, a.branch.id))
      .expect(403);
    await auth(request(http()).post(url))
      .send(staffBody(bmRoleId, a.branch.id))
      .expect(403);
  });

  it('a BRANCH_MANAGER may create a plain STAFF member (201)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const staffRoleId = await roleIdByCode(prisma, 'STAFF');
    const bm = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: `bm-${randomUUID()}@x.com`,
      roleCode: 'BRANCH_MANAGER',
      assignToBranch: true,
    });
    const auth = await authFor(bm.profileId, a.org.id);
    const url = `/v1/organizations/${a.org.id}/branches/${a.branch.id}/staff`;

    const res = await auth(request(http()).post(url))
      .send(staffBody(staffRoleId, a.branch.id))
      .expect(201);
    expect(res.body.data.profile_id).toBeDefined();
  });

  it('an OWNER may create a staff member with a privileged (BRANCH_MANAGER) role (201)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const bmRoleId = await roleIdByCode(prisma, 'BRANCH_MANAGER');
    const auth = await authFor(a.ownerProfileId, a.org.id);
    const url = `/v1/organizations/${a.org.id}/branches/${a.branch.id}/staff`;

    await auth(request(http()).post(url))
      .send(staffBody(bmRoleId, a.branch.id))
      .expect(201);
  });

  it('a BRANCH_MANAGER cannot promote an existing STAFF member to a privileged role (403)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const bmRoleId = await roleIdByCode(prisma, 'BRANCH_MANAGER');
    const bm = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: `bm-${randomUUID()}@x.com`,
      roleCode: 'BRANCH_MANAGER',
      assignToBranch: true,
    });
    const target = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: `target-${randomUUID()}@x.com`,
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const auth = await authFor(bm.profileId, a.org.id);
    const url = `/v1/organizations/${a.org.id}/branches/${a.branch.id}/staff/${target.profileId}`;

    await auth(request(http()).patch(url))
      .send({ role_id: bmRoleId })
      .expect(403);
  });

  it('a BRANCH_MANAGER can remove a STAFF member from their branch (204)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const bm = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: `bm-${randomUUID()}@x.com`,
      roleCode: 'BRANCH_MANAGER',
      assignToBranch: true,
    });
    const target = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: `target-${randomUUID()}@x.com`,
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const auth = await authFor(bm.profileId, a.org.id);
    const url = `/v1/organizations/${a.org.id}/branches/${a.branch.id}/staff/${target.profileId}`;

    await auth(request(http()).delete(url)).expect(204);
  });

  it('a STAFF caller is rejected by the permission guard when removing staff (403)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const caller = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: `staff-${randomUUID()}@x.com`,
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const target = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: `target-${randomUUID()}@x.com`,
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const auth = await authFor(caller.profileId, a.org.id);
    const url = `/v1/organizations/${a.org.id}/branches/${a.branch.id}/staff/${target.profileId}`;

    await auth(request(http()).delete(url)).expect(403);
  });
});
