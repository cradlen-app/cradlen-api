import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';
import { bearer } from '../../helpers/auth-helpers';
import { loginAs, seedOrg } from '../../helpers/financial-helpers';

/**
 * Service catalog CRUD against real Postgres: create (with the per-org unique
 * code), list + filters, getOne, update, activate/deactivate, soft-delete, and
 * the duplicate-code conflict.
 */
describe('Financial — service catalog (integration)', () => {
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
    const svc = `/v1/organizations/${a.org.id}/financial/catalog/services`;
    return { a, auth, svc, http: app.getHttpServer() };
  }

  const makeService = (over: Record<string, unknown> = {}) => ({
    code: `CONSULT-${Math.floor(Math.random() * 1e6)}`,
    name: 'Consultation',
    service_type: 'CONSULTATION',
    ...over,
  });

  it('creates a service and echoes code + active flag', async () => {
    const { auth, svc, http } = await setup();
    const body = makeService({ code: 'CONSULT-A1' });
    const res = await auth(request(http).post(svc)).send(body).expect(201);

    expect(res.body.data).toMatchObject({
      code: 'CONSULT-A1',
      name: 'Consultation',
      service_type: 'CONSULTATION',
      is_active: true,
    });
    expect(res.body.data.id).toBeTruthy();
  });

  it('lists services and filters by active + service_type', async () => {
    const { auth, svc, http } = await setup();
    const a = await auth(request(http).post(svc))
      .send(makeService({ name: 'Active one' }))
      .expect(201);
    await auth(
      request(http).post(svc).send(makeService({ name: 'Procedure', service_type: 'PROCEDURE' })),
    ).expect(201);
    await auth(
      request(http).post(`${svc}/${a.body.data.id}/deactivate`),
    ).expect(201);

    const all = await auth(request(http).get(svc)).expect(200);
    expect(all.body.data.length).toBeGreaterThanOrEqual(2);
    expect(all.body.meta.total).toBeGreaterThanOrEqual(2);

    const activeOnly = await auth(
      request(http).get(svc).query({ active: 'false' }),
    ).expect(200);
    expect(
      activeOnly.body.data.every((s: { is_active: boolean }) => !s.is_active),
    ).toBe(true);

    const procedures = await auth(
      request(http).get(svc).query({ service_type: 'PROCEDURE' }),
    ).expect(200);
    expect(
      procedures.body.data.every(
        (s: { service_type: string }) => s.service_type === 'PROCEDURE',
      ),
    ).toBe(true);
  });

  it('reads one service by id', async () => {
    const { auth, svc, http } = await setup();
    const created = await auth(request(http).post(svc))
      .send(makeService({ code: 'X-1' }))
      .expect(201);

    const res = await auth(
      request(http).get(`${svc}/${created.body.data.id}`),
    ).expect(200);
    expect(res.body.data.code).toBe('X-1');
  });

  it('updates a service name and type', async () => {
    const { auth, svc, http } = await setup();
    const created = await auth(request(http).post(svc))
      .send(makeService())
      .expect(201);

    const res = await auth(request(http).patch(`${svc}/${created.body.data.id}`))
      .send({ name: 'Renamed', service_type: 'IMAGING' })
      .expect(200);
    expect(res.body.data).toMatchObject({
      name: 'Renamed',
      service_type: 'IMAGING',
    });
  });

  it('activates and deactivates a service', async () => {
    const { auth, svc, http } = await setup();
    const created = await auth(request(http).post(svc))
      .send(makeService())
      .expect(201);
    const id = created.body.data.id;

    const off = await auth(
      request(http).post(`${svc}/${id}/deactivate`),
    ).expect(201);
    expect(off.body.data.is_active).toBe(false);

    const on = await auth(request(http).post(`${svc}/${id}/activate`)).expect(
      201,
    );
    expect(on.body.data.is_active).toBe(true);
  });

  it('soft-deletes a service so it drops out of the list', async () => {
    const { auth, svc, http } = await setup();
    const created = await auth(request(http).post(svc))
      .send(makeService({ code: 'DEL-1' }))
      .expect(201);
    const id = created.body.data.id;

    await auth(request(http).delete(`${svc}/${id}`)).expect(204);

    const list = await auth(request(http).get(svc)).expect(200);
    expect(list.body.data.some((s: { id: string }) => s.id === id)).toBe(false);
    await auth(request(http).get(`${svc}/${id}`)).expect(404);
  });

  it('rejects a duplicate code within the org (409)', async () => {
    const { auth, svc, http } = await setup();
    await auth(request(http).post(svc)).send(makeService({ code: 'DUP-1' })).expect(201);
    await auth(request(http).post(svc)).send(makeService({ code: 'DUP-1' })).expect(409);
  });
});
