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
 * Authorization boundaries for the service catalog (services + categories).
 * Read is org-membership; write is OWNER-only. The :orgId path is attacker-
 * controlled, so cross-org is gated (403) before any row lookup; 404 is only
 * same-org-unknown-id.
 */
describe('Financial — catalog security (integration)', () => {
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

  const svcBase = (orgId: string) =>
    `/v1/organizations/${orgId}/financial/catalog/services`;
  const catBase = (orgId: string) =>
    `/v1/organizations/${orgId}/financial/catalog/categories`;

  const makeService = (over: Record<string, unknown> = {}) => ({
    code: `S-${Math.floor(Math.random() * 1e6)}`,
    name: 'Consultation',
    service_type: 'CONSULTATION',
    ...over,
  });

  async function ownerCreatesService(orgId: string, ownerEmail: string) {
    const auth = bearer(await loginAs(app, ownerEmail));
    const res = await auth(request(app.getHttpServer()).post(svcBase(orgId)))
      .send(makeService())
      .expect(201);
    return { auth, id: res.body.data.id as string };
  }

  it('rejects unauthenticated requests with 401', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const http = app.getHttpServer();
    await request(http).get(svcBase(a.org.id)).expect(401);
    await request(http).get(catBase(a.org.id)).expect(401);
  });

  it('denies an OWNER of another org all catalog access (403)', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    await seedOrg(prisma, 'Org B', 'owner.b@example.com');
    const { id: serviceA } = await ownerCreatesService(a.org.id, a.ownerEmail);
    const authB = bearer(await loginAs(app, 'owner.b@example.com'));
    const http = app.getHttpServer();

    await authB(request(http).get(svcBase(a.org.id))).expect(403);
    await authB(
      request(http).post(svcBase(a.org.id)).send(makeService()),
    ).expect(403);
    await authB(request(http).get(`${svcBase(a.org.id)}/${serviceA}`)).expect(
      403,
    );
    await authB(
      request(http)
        .patch(`${svcBase(a.org.id)}/${serviceA}`)
        .send({ name: 'x' }),
    ).expect(403);
    await authB(
      request(http).delete(`${svcBase(a.org.id)}/${serviceA}`),
    ).expect(403);

    await authB(request(http).get(catBase(a.org.id))).expect(403);
    await authB(
      request(http).post(catBase(a.org.id)).send({ code: 'X', name: 'X' }),
    ).expect(403);
  });

  it('lets a STAFF member read but not write the catalog (403)', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const { id: serviceA } = await ownerCreatesService(a.org.id, a.ownerEmail);
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

    await authStaff(request(http).get(svcBase(a.org.id))).expect(200);
    await authStaff(
      request(http).post(svcBase(a.org.id)).send(makeService()),
    ).expect(403);
    await authStaff(
      request(http)
        .patch(`${svcBase(a.org.id)}/${serviceA}`)
        .send({ name: 'x' }),
    ).expect(403);
    await authStaff(
      request(http).delete(`${svcBase(a.org.id)}/${serviceA}`),
    ).expect(403);
  });

  it('returns 404 for an unknown service id in the own org', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    const http = app.getHttpServer();
    const ghost = randomUUID();

    await auth(request(http).get(`${svcBase(a.org.id)}/${ghost}`)).expect(404);
    await auth(
      request(http)
        .patch(`${svcBase(a.org.id)}/${ghost}`)
        .send({ name: 'x' }),
    ).expect(404);
    await auth(request(http).delete(`${svcBase(a.org.id)}/${ghost}`)).expect(
      404,
    );
  });

  it('rejects a duplicate service code with 409', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    const http = app.getHttpServer();
    await auth(
      request(http)
        .post(svcBase(a.org.id))
        .send(makeService({ code: 'DUP' })),
    ).expect(201);
    await auth(
      request(http)
        .post(svcBase(a.org.id))
        .send(makeService({ code: 'DUP' })),
    ).expect(409);
  });

  it('rejects malformed input with 400', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    const http = app.getHttpServer();

    // Missing required code.
    await auth(
      request(http)
        .post(svcBase(a.org.id))
        .send({ name: 'No code', service_type: 'CONSULTATION' }),
    ).expect(400);
    // Bad enum.
    await auth(
      request(http)
        .post(svcBase(a.org.id))
        .send(makeService({ service_type: 'BOGUS' })),
    ).expect(400);
    // Non-UUID category_id.
    await auth(
      request(http)
        .post(svcBase(a.org.id))
        .send(makeService({ category_id: 'not-a-uuid' })),
    ).expect(400);
    // Non-UUID orgId path.
    await auth(
      request(http).get(
        '/v1/organizations/not-a-uuid/financial/catalog/services',
      ),
    ).expect(400);
  });
});
