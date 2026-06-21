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
import { bearer } from '../../helpers/auth-helpers';
import { seedOrg } from '../../helpers/financial-helpers';

/**
 * `GET /v1/medications?search=` org-scope (global ∪ caller org) + `POST` create:
 *  - another org's catalog row is excluded from the caller's search;
 *  - create persists an org row (organization_id = caller org,
 *    added_by_id = caller profile).
 *
 * NOTE: medications is a seed/lookup table NOT truncated by cleanDatabase.
 * Org-scoped rows cascade away when their org is truncated, but rows are also
 * removed here by their unique BATCH5 code prefix to avoid cross-suite leakage.
 */
describe('Medications — org-scoped read + create (integration)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let prisma: PrismaClient;
  const jwt = new JwtService({});

  const CODE_PREFIX = 'BATCH5-MED-';

  beforeAll(async () => {
    mailMock = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp(mailMock);
    prisma = getTestPrisma();
  });

  afterAll(async () => {
    await prisma.medication.deleteMany({
      where: { code: { startsWith: CODE_PREFIX } },
    });
    await disconnectTestPrisma();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.medication.deleteMany({
      where: { code: { startsWith: CODE_PREFIX } },
    });
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

  it('search excludes another org medication, includes own + global', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-a-${randomUUID()}@x.com`);
    const b = await seedOrg(prisma, 'Clinic B', `owner-b-${randomUUID()}@x.com`);
    const tag = randomUUID().slice(0, 8);

    const mine = await prisma.medication.create({
      data: {
        organization_id: a.org.id,
        code: `${CODE_PREFIX}A-${tag}`,
        name: `ZZBatchDrug ${tag} Mine`,
        added_by_id: a.ownerProfileId,
      },
    });
    const foreign = await prisma.medication.create({
      data: {
        organization_id: b.org.id,
        code: `${CODE_PREFIX}B-${tag}`,
        name: `ZZBatchDrug ${tag} Foreign`,
        added_by_id: b.ownerProfileId,
      },
    });
    const global = await prisma.medication.create({
      data: {
        organization_id: null,
        code: `${CODE_PREFIX}G-${tag}`,
        name: `ZZBatchDrug ${tag} Global`,
        added_by_id: null,
      },
    });

    const auth = await authFor(a.ownerProfileId, a.org.id);
    const res = await auth(
      request(http()).get(`/v1/medications?search=ZZBatchDrug ${tag}`),
    ).expect(200);
    const ids: string[] = res.body.data.map((m: { id: string }) => m.id);

    expect(ids).toContain(mine.id);
    expect(ids).toContain(global.id);
    expect(ids).not.toContain(foreign.id);
  });

  it('POST creates an org-scoped medication with added_by_id = caller', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const auth = await authFor(a.ownerProfileId, a.org.id);
    const code = `${CODE_PREFIX}NEW-${randomUUID().slice(0, 8)}`;

    const res = await auth(request(http()).post('/v1/medications'))
      .send({ code, name: 'Batch5 Paracetamol' })
      .expect(201);

    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.organization_id).toBe(a.org.id);
    expect(res.body.data.added_by_id).toBe(a.ownerProfileId);

    const row = await prisma.medication.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(row.organization_id).toBe(a.org.id);
    expect(row.added_by_id).toBe(a.ownerProfileId);
  });

  it('rejects a duplicate code within the same org (409)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const auth = await authFor(a.ownerProfileId, a.org.id);
    const code = `${CODE_PREFIX}DUP-${randomUUID().slice(0, 8)}`;

    await auth(request(http()).post('/v1/medications'))
      .send({ code, name: 'First' })
      .expect(201);
    await auth(request(http()).post('/v1/medications'))
      .send({ code, name: 'Second' })
      .expect(409);
  });
});
