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
 * Authorization boundaries for the financial reporting endpoints. The
 * :orgId path segment is attacker-controlled, so the service-level
 * `authorizeScope` gate (org management for org-wide, branch membership for
 * branch-scoped) is what isolates tenants — not the route. Cross-org isolation
 * is asserted for every endpoint; the remaining boundaries on a representative
 * endpoint.
 */
const ENDPOINTS = [
  'revenue',
  'daily-revenue',
  'revenue-by-service',
  'revenue-by-doctor',
  'payments-by-method',
  'ar-aging',
  'collections',
  'write-offs',
  'outstanding-invoices',
] as const;

describe('Financial — reports security (integration)', () => {
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

  const reportsBase = (orgId: string) =>
    `/v1/organizations/${orgId}/financial/reports`;

  it('rejects unauthenticated requests with 401', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const http = app.getHttpServer();
    await request(http)
      .get(`${reportsBase(a.org.id)}/revenue`)
      .expect(401);
    await request(http)
      .get(`${reportsBase(a.org.id)}/outstanding-invoices`)
      .expect(401);
  });

  it('denies an OWNER cross-org access to every report endpoint (403)', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    await seedOrg(prisma, 'Org B', 'owner.b@example.com');
    const authB = bearer(await loginAs(app, 'owner.b@example.com'));
    const http = app.getHttpServer();

    for (const ep of ENDPOINTS) {
      await authB(request(http).get(`${reportsBase(a.org.id)}/${ep}`)).expect(
        403,
      );
    }
  });

  it('denies a non-OWNER (BRANCH_MANAGER) org-wide reports (403)', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const bmEmail = `bm-${randomUUID()}@example.com`;
    await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: bmEmail,
      roleCode: 'BRANCH_MANAGER',
      assignToBranch: true,
    });
    const authBm = bearer(await loginAs(app, bmEmail));

    await authBm(
      request(app.getHttpServer()).get(`${reportsBase(a.org.id)}/revenue`),
    ).expect(403);
  });

  it('bounds a BRANCH_MANAGER to its assigned branch (200 assigned, 403 other)', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const branch2 = await prisma.branch.create({
      data: {
        organization_id: a.org.id,
        name: 'Branch Two',
        address: '2 St',
        city: 'Giza',
        governorate: 'Giza',
      },
    });
    const bmEmail = `bm-${randomUUID()}@example.com`;
    await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: bmEmail,
      roleCode: 'BRANCH_MANAGER',
      assignToBranch: true,
    });
    const authBm = bearer(await loginAs(app, bmEmail));
    const http = app.getHttpServer();

    await authBm(
      request(http)
        .get(`${reportsBase(a.org.id)}/revenue`)
        .query({ branch_id: a.branch.id }),
    ).expect(200);

    await authBm(
      request(http)
        .get(`${reportsBase(a.org.id)}/revenue`)
        .query({ branch_id: branch2.id }),
    ).expect(403);
  });

  it('rejects malformed params with 400', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    const http = app.getHttpServer();

    // Non-UUID branch_id (DTO @IsUUID).
    await auth(
      request(http)
        .get(`${reportsBase(a.org.id)}/revenue`)
        .query({ branch_id: 'not-a-uuid' }),
    ).expect(400);

    // Non-date date_from (DTO @IsDateString).
    await auth(
      request(http)
        .get(`${reportsBase(a.org.id)}/revenue`)
        .query({ date_from: 'nope' }),
    ).expect(400);

    // Non-UUID orgId path param (ParseUUIDPipe).
    await auth(
      request(http).get(
        '/v1/organizations/not-a-uuid/financial/reports/revenue',
      ),
    ).expect(400);
  });

  it('allows the OWNER org-wide reports for its own org (200)', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    await auth(
      request(app.getHttpServer()).get(`${reportsBase(a.org.id)}/revenue`),
    ).expect(200);
  });
});
