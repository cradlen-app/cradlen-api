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
 * Cross-tenant access control (IDOR). An OWNER of one organization must never
 * reach another organization's org- or branch-scoped surfaces — the path
 * :organizationId is attacker-controlled, so the gate (not the route) is what
 * keeps tenants isolated. Also covers branch-scope bounding for a
 * BRANCH_MANAGER within a single org. (Financial cross-tenant is covered by
 * financial-lifecycle.spec.ts; this adds the org/branch/invitation surfaces.)
 */
describe('Auth — cross-tenant authorization (integration)', () => {
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

  it("Org A's OWNER cannot read or write Org B's branches, but can manage its own", async () => {
    const a = await signupOwner(app, mailMock, { organizationName: 'Org A' });
    const b = await signupOwner(app, mailMock, { organizationName: 'Org B' });
    const http = app.getHttpServer();
    const authA = bearer(a.accessToken);

    // Read Org B's branches → 403.
    await authA(
      request(http).get(`/v1/organizations/${b.orgId}/branches`),
    ).expect(403);

    // Create a branch in Org B → 403.
    await authA(request(http).post(`/v1/organizations/${b.orgId}/branches`))
      .send({
        name: 'Rogue',
        address: '9 St',
        city: 'Cairo',
        governorate: 'Cairo',
        country: 'Egypt',
      })
      .expect(403);

    // Sanity: each owner manages their own org.
    await authA(
      request(http).get(`/v1/organizations/${a.orgId}/branches`),
    ).expect(200);
    await bearer(b.accessToken)(
      request(http).get(`/v1/organizations/${b.orgId}/branches`),
    ).expect(200);
  });

  it("Org A's OWNER cannot create an invitation inside Org B", async () => {
    const a = await signupOwner(app, mailMock, { organizationName: 'Org A' });
    const b = await signupOwner(app, mailMock, { organizationName: 'Org B' });
    const staffRoleId = await roleIdByCode(prisma, 'STAFF');

    await bearer(a.accessToken)(
      request(app.getHttpServer()).post(
        `/v1/organizations/${b.orgId}/branches/${b.branchId}/invitations`,
      ),
    )
      .send({
        email: `victim-${randomUUID()}@example.com`,
        first_name: 'V',
        last_name: 'X',
        role_ids: [staffRoleId],
        branch_ids: [b.branchId],
      })
      .expect(403);
  });

  it('a BRANCH_MANAGER is bounded to assigned branches within its own org', async () => {
    const a = await signupOwner(app, mailMock, { organizationName: 'Org A' });
    const http = app.getHttpServer();

    // A second branch the manager is NOT assigned to. Seeded directly because
    // the free-trial plan caps branch creation at one via the HTTP path.
    const branch2 = await prisma.branch.create({
      data: {
        organization_id: a.orgId,
        name: 'Branch Two',
        address: '2 St',
        city: 'Giza',
        governorate: 'Giza',
      },
    });
    const branch2Id = branch2.id;

    // A BRANCH_MANAGER assigned only to the main branch (a.branchId).
    const bmEmail = `bm-${randomUUID()}@example.com`;
    await seedMember(prisma, {
      orgId: a.orgId,
      branchId: a.branchId,
      email: bmEmail,
      roleCode: 'BRANCH_MANAGER',
      assignToBranch: true,
    });
    const bm = await loginAndSelect(app, bmEmail);
    const authBm = bearer(bm.accessToken);

    // Can list invitations on its assigned branch …
    await authBm(
      request(http).get(
        `/v1/organizations/${a.orgId}/branches/${a.branchId}/invitations`,
      ),
    ).expect(200);

    // … but not on a branch outside its scope.
    await authBm(
      request(http).get(
        `/v1/organizations/${a.orgId}/branches/${branch2Id}/invitations`,
      ),
    ).expect(403);
  });
});
