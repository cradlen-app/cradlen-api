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
import { bearer, seedMember } from '../../helpers/auth-helpers';
import { loginAs, seedOrg } from '../../helpers/financial-helpers';

/**
 * Authorization boundaries for price lists and provider services/overrides.
 * Read = org membership; price-list writes = OWNER; provider writes = staff
 * manager (OWNER/BRANCH_MANAGER). Cross-org → 403; a provider profile outside
 * the org → 404 on the write path (`assertProfileInOrg`).
 */
describe('Financial — pricing security (integration)', () => {
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

  const listsBase = (orgId: string) =>
    `/v1/organizations/${orgId}/financial/price-lists`;
  const providerBase = (orgId: string, profileId: string) =>
    `/v1/organizations/${orgId}/providers/${profileId}`;

  // ---------- price lists ----------

  it('price-lists: 401 unauthenticated; cross-org 403; unknown id 404', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    await seedOrg(prisma, 'Org B', 'owner.b@example.com');
    const authA = bearer(await loginAs(app, a.ownerEmail));
    const authB = bearer(await loginAs(app, 'owner.b@example.com'));
    const http = app.getHttpServer();

    await request(http).get(listsBase(a.org.id)).expect(401);

    const created = await authA(request(http).post(listsBase(a.org.id)))
      .send({ name: 'Standard' })
      .expect(201);

    await authB(request(http).get(listsBase(a.org.id))).expect(403);
    await authB(
      request(http).post(listsBase(a.org.id)).send({ name: 'X' }),
    ).expect(403);
    await authB(
      request(http).get(`${listsBase(a.org.id)}/${created.body.data.id}`),
    ).expect(403);

    await authA(
      request(http).get(`${listsBase(a.org.id)}/${randomUUID()}`),
    ).expect(404);
    await authA(
      request(http).get('/v1/organizations/not-a-uuid/financial/price-lists'),
    ).expect(400);
  });

  it('price-lists: a STAFF member can read but not create (403)', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const staffEmail = `staff-${randomUUID()}@example.com`;
    await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: staffEmail,
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const authStaff = bearer(await loginAs(app, staffEmail));
    const http = app.getHttpServer();

    await authStaff(request(http).get(listsBase(a.org.id))).expect(200);
    await authStaff(
      request(http).post(listsBase(a.org.id)).send({ name: 'Nope' }),
    ).expect(403);
  });

  // ---------- provider services ----------

  it('provider: cross-org 403 and a STAFF member cannot authorize (403)', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    await seedOrg(prisma, 'Org B', 'owner.b@example.com');
    const { profileId: providerId } = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: `doc-${randomUUID()}@example.com`,
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const staffEmail = `staff-${randomUUID()}@example.com`;
    await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: staffEmail,
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const authB = bearer(await loginAs(app, 'owner.b@example.com'));
    const authStaff = bearer(await loginAs(app, staffEmail));
    const http = app.getHttpServer();

    // Cross-org owner: read + write blocked.
    await authB(
      request(http).get(`${providerBase(a.org.id, providerId)}/services`),
    ).expect(403);
    await authB(
      request(http)
        .post(`${providerBase(a.org.id, providerId)}/services`)
        .send({ service_id: randomUUID() }),
    ).expect(403);

    // In-org STAFF: cannot manage staff authorizations.
    await authStaff(
      request(http)
        .post(`${providerBase(a.org.id, providerId)}/services`)
        .send({ service_id: randomUUID() }),
    ).expect(403);
  });

  it('provider: authorizing for a profile outside the org → 404', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const b = await seedOrg(prisma, 'Org B', 'owner.b@example.com');
    const { profileId: providerB } = await seedMember(prisma, {
      orgId: b.org.id,
      branchId: b.branch.id,
      email: `doc-${randomUUID()}@example.com`,
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const authA = bearer(await loginAs(app, a.ownerEmail));
    const http = app.getHttpServer();

    // Owner A authorizes against a provider that lives in org B → not found.
    await authA(
      request(http)
        .post(`${providerBase(a.org.id, providerB)}/services`)
        .send({ service_id: randomUUID() }),
    ).expect(404);

    // Non-UUID profileId → 400.
    await authA(
      request(http).get(
        `/v1/organizations/${a.org.id}/providers/not-a-uuid/services`,
      ),
    ).expect(400);
  });
});
