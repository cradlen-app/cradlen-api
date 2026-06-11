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
 * Service-category CRUD against real Postgres: create, list, update, delete,
 * the per-org unique-code conflict, and a service referencing the category.
 */
describe('Financial — service categories (integration)', () => {
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
    const base = `/v1/organizations/${a.org.id}/financial/catalog`;
    return { a, auth, base, http: app.getHttpServer() };
  }

  it('creates, lists, updates and deletes a category', async () => {
    const { auth, base, http } = await setup();
    const cats = `${base}/categories`;

    const created = await auth(request(http).post(cats))
      .send({ code: 'LAB', name: 'Laboratory' })
      .expect(201);
    expect(created.body.data).toMatchObject({ code: 'LAB', name: 'Laboratory' });
    const id = created.body.data.id;

    const list = await auth(request(http).get(cats)).expect(200);
    expect(list.body.data.some((c: { id: string }) => c.id === id)).toBe(true);

    const updated = await auth(request(http).patch(`${cats}/${id}`))
      .send({ name: 'Lab & Pathology' })
      .expect(200);
    expect(updated.body.data.name).toBe('Lab & Pathology');

    await auth(request(http).delete(`${cats}/${id}`)).expect(204);
    const after = await auth(request(http).get(cats)).expect(200);
    expect(after.body.data.some((c: { id: string }) => c.id === id)).toBe(false);
  });

  it('rejects a duplicate category code within the org (409)', async () => {
    const { auth, base, http } = await setup();
    const cats = `${base}/categories`;
    await auth(request(http).post(cats)).send({ code: 'IMG', name: 'Imaging' }).expect(201);
    await auth(request(http).post(cats)).send({ code: 'IMG', name: 'Imaging 2' }).expect(409);
  });

  it('lets a service reference the category and embeds it on the response', async () => {
    const { auth, base, http } = await setup();
    const cat = await auth(request(http).post(`${base}/categories`))
      .send({ code: 'CONS', name: 'Consults' })
      .expect(201);

    const svc = await auth(request(http).post(`${base}/services`))
      .send({
        code: `S-${Math.floor(Math.random() * 1e6)}`,
        name: 'Consultation',
        service_type: 'CONSULTATION',
        category_id: cat.body.data.id,
      })
      .expect(201);

    expect(svc.body.data.category).toMatchObject({
      id: cat.body.data.id,
      code: 'CONS',
      name: 'Consults',
    });
  });

  it('rejects creating a category with no code (400)', async () => {
    const { auth, base, http } = await setup();
    await auth(request(http).post(`${base}/categories`))
      .send({ name: 'No code' })
      .expect(400);
  });
});
