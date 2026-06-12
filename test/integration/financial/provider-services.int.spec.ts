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
 * Provider service authorizations + per-provider price overrides against real
 * Postgres: authorize → activate/deactivate → revoke, the duplicate-auth
 * conflict, the "must be authorized first" guard on overrides, and override
 * CRUD + duplicate conflict.
 */
describe('Financial — provider services & overrides (integration)', () => {
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

  async function setup() {
    const a = await seedOrg(prisma, 'Clinic A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    const { profileId: providerId } = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: `doc-${randomUUID()}@example.com`,
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const base = `/v1/organizations/${a.org.id}`;
    const provider = `${base}/providers/${providerId}`;
    const http = app.getHttpServer();
    return { a, auth, base, provider, providerId, http };
  }

  async function createService(
    auth: ReturnType<typeof bearer>,
    base: string,
    http: ReturnType<INestApplication['getHttpServer']>,
  ): Promise<string> {
    const res = await auth(
      request(http).post(`${base}/financial/catalog/services`),
    )
      .send({
        code: `S-${Math.floor(Math.random() * 1e6)}`,
        name: 'Consultation',
        service_type: 'CONSULTATION',
      })
      .expect(201);
    return res.body.data.id as string;
  }

  it('authorizes, toggles and revokes a provider service', async () => {
    const { auth, base, provider, http } = await setup();
    const serviceId = await createService(auth, base, http);

    await auth(request(http).post(`${provider}/services`))
      .send({ service_id: serviceId, duration_minutes: 30 })
      .expect(201);

    const list = await auth(request(http).get(`${provider}/services`)).expect(
      200,
    );
    expect(
      list.body.data.some(
        (s: { service_id: string }) => s.service_id === serviceId,
      ),
    ).toBe(true);

    const off = await auth(
      request(http).post(`${provider}/services/${serviceId}/deactivate`),
    ).expect(201);
    expect(off.body.data.is_active).toBe(false);
    await auth(
      request(http).post(`${provider}/services/${serviceId}/activate`),
    ).expect(201);

    await auth(
      request(http).delete(`${provider}/services/${serviceId}`),
    ).expect(204);
    const after = await auth(request(http).get(`${provider}/services`)).expect(
      200,
    );
    expect(
      after.body.data.some(
        (s: { service_id: string }) => s.service_id === serviceId,
      ),
    ).toBe(false);
  });

  it('rejects a duplicate service authorization (409)', async () => {
    const { auth, base, provider, http } = await setup();
    const serviceId = await createService(auth, base, http);
    await auth(request(http).post(`${provider}/services`))
      .send({ service_id: serviceId })
      .expect(201);
    await auth(request(http).post(`${provider}/services`))
      .send({ service_id: serviceId })
      .expect(409);
  });

  it('refuses an override for a service the provider is not authorized for (400)', async () => {
    const { auth, base, provider, http } = await setup();
    const serviceId = await createService(auth, base, http);
    await auth(request(http).post(`${provider}/price-overrides`))
      .send({ service_id: serviceId, price: 500 })
      .expect(400);
  });

  it('creates, updates, toggles and deletes a price override', async () => {
    const { auth, base, provider, http } = await setup();
    const serviceId = await createService(auth, base, http);
    await auth(request(http).post(`${provider}/services`))
      .send({ service_id: serviceId })
      .expect(201);

    const created = await auth(
      request(http).post(`${provider}/price-overrides`),
    )
      .send({ service_id: serviceId, price: 500 })
      .expect(201);
    const id = created.body.data.id;
    expect(Number(created.body.data.price)).toBe(500);

    const updated = await auth(
      request(http).patch(`${provider}/price-overrides/${id}`),
    )
      .send({ price: 650 })
      .expect(200);
    expect(Number(updated.body.data.price)).toBe(650);

    const off = await auth(
      request(http).post(`${provider}/price-overrides/${id}/deactivate`),
    ).expect(201);
    expect(off.body.data.is_active).toBe(false);
    await auth(
      request(http).post(`${provider}/price-overrides/${id}/activate`),
    ).expect(201);

    await auth(
      request(http).delete(`${provider}/price-overrides/${id}`),
    ).expect(204);
  });

  it('rejects a duplicate active override for the same provider/service (409)', async () => {
    const { auth, base, provider, http } = await setup();
    const serviceId = await createService(auth, base, http);
    await auth(request(http).post(`${provider}/services`))
      .send({ service_id: serviceId })
      .expect(201);
    await auth(request(http).post(`${provider}/price-overrides`))
      .send({ service_id: serviceId, price: 500 })
      .expect(201);
    await auth(request(http).post(`${provider}/price-overrides`))
      .send({ service_id: serviceId, price: 600 })
      .expect(409);
  });
});
