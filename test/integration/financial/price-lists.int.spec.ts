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
 * Price-list management against real Postgres: create, the single-default
 * invariant (set-default / is_default unsets the prior), activate/deactivate,
 * items (add → update → remove + bulk replace), and date/discount validation.
 */
describe('Financial — price lists (integration)', () => {
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
    const base = `/v1/organizations/${a.org.id}/financial`;
    const lists = `${base}/price-lists`;
    return { a, auth, base, lists, http: app.getHttpServer() };
  }

  async function createService(
    auth: ReturnType<typeof bearer>,
    base: string,
    http: ReturnType<INestApplication['getHttpServer']>,
  ): Promise<string> {
    const res = await auth(request(http).post(`${base}/catalog/services`))
      .send({
        code: `S-${Math.floor(Math.random() * 1e6)}`,
        name: 'Consultation',
        service_type: 'CONSULTATION',
      })
      .expect(201);
    return res.body.data.id as string;
  }

  it('creates an org-wide price list', async () => {
    const { auth, lists, http } = await setup();
    const res = await auth(request(http).post(lists))
      .send({ name: 'Standard', currency: 'EGP', is_default: true })
      .expect(201);
    expect(res.body.data).toMatchObject({ name: 'Standard', is_default: true });
  });

  it('keeps a single default in scope when a new default is set', async () => {
    const { auth, lists, http } = await setup();
    const first = await auth(request(http).post(lists))
      .send({ name: 'First', is_default: true })
      .expect(201);
    const second = await auth(request(http).post(lists))
      .send({ name: 'Second', is_default: true })
      .expect(201);

    const list = await auth(request(http).get(lists)).expect(200);
    const byId = (id: string) =>
      list.body.data.find((p: { id: string }) => p.id === id);
    expect(byId(first.body.data.id).is_default).toBe(false);
    expect(byId(second.body.data.id).is_default).toBe(true);

    // Flip the default back via the dedicated endpoint.
    await auth(
      request(http).post(`${lists}/${first.body.data.id}/set-default`),
    ).expect(201);
    const after = await auth(request(http).get(lists)).expect(200);
    expect(
      after.body.data.find((p: { id: string }) => p.id === first.body.data.id)
        .is_default,
    ).toBe(true);
  });

  it('activates and deactivates a price list', async () => {
    const { auth, lists, http } = await setup();
    const created = await auth(request(http).post(lists))
      .send({ name: 'Toggle' })
      .expect(201);
    const id = created.body.data.id;

    const off = await auth(
      request(http).post(`${lists}/${id}/deactivate`),
    ).expect(201);
    expect(off.body.data.is_active).toBe(false);
    const on = await auth(request(http).post(`${lists}/${id}/activate`)).expect(
      201,
    );
    expect(on.body.data.is_active).toBe(true);
  });

  it('adds, updates, bulk-replaces and removes items', async () => {
    const { auth, base, lists, http } = await setup();
    const listId = (
      await auth(request(http).post(lists)).send({ name: 'Items' }).expect(201)
    ).body.data.id;
    const serviceId = await createService(auth, base, http);

    const item = await auth(request(http).post(`${lists}/${listId}/items`))
      .send({ service_id: serviceId, unit_price: 250 })
      .expect(201);
    const itemId = item.body.data.id;
    expect(Number(item.body.data.unit_price)).toBe(250);

    const updated = await auth(
      request(http).patch(`${lists}/${listId}/items/${itemId}`),
    )
      .send({ unit_price: 300 })
      .expect(200);
    expect(Number(updated.body.data.unit_price)).toBe(300);

    // Bulk replace the item set.
    const service2 = await createService(auth, base, http);
    await auth(request(http).put(`${lists}/${listId}/items`))
      .send({ items: [{ service_id: service2, unit_price: 120 }] })
      .expect(200);
    const afterBulk = await auth(
      request(http).get(`${lists}/${listId}/items`),
    ).expect(200);
    expect(afterBulk.body.data).toHaveLength(1);
    expect(afterBulk.body.data[0].service_id).toBe(service2);

    await auth(
      request(http).delete(
        `${lists}/${listId}/items/${afterBulk.body.data[0].id}`,
      ),
    ).expect(204);
    const empty = await auth(
      request(http).get(`${lists}/${listId}/items`),
    ).expect(200);
    expect(empty.body.data).toHaveLength(0);
  });

  it('rejects an inverted valid_from/valid_to range (400)', async () => {
    const { auth, lists, http } = await setup();
    await auth(request(http).post(lists))
      .send({
        name: 'Bad dates',
        valid_from: '2026-02-01',
        valid_to: '2026-01-01',
      })
      .expect(400);
  });

  it('rejects a PERCENTAGE discount over 100 (400)', async () => {
    const { auth, lists, http } = await setup();
    await auth(request(http).post(lists))
      .send({
        name: 'Bad discount',
        discount_type: 'PERCENTAGE',
        discount_value: 150,
      })
      .expect(400);
  });
});
