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
import { seedVisit } from '../../helpers/visits-helpers';

/**
 * `GET /branches/:branchId/visits/stats` and the org-wide variant against real
 * Postgres. The endpoint reports attended-visit counts (`checked_in_at` set) for
 * the current vs the previous calendar month, grouped by appointment type, plus a
 * per-day series for the current month.
 */
describe('Visits — monthly stats (integration)', () => {
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

  const http = () => app.getHttpServer();
  const branchStats = (branchId: string) =>
    `/v1/branches/${branchId}/visits/stats`;
  const orgStats = (orgId: string) => `/v1/organizations/${orgId}/visits/stats`;

  const now = new Date();
  // A safe day inside the previous calendar month.
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);

  it('counts attended visits this month vs last, grouped by type', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'doc.a@example.com');
    const common = {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      status: 'COMPLETED' as const,
    };

    // Current month: 2 visits + 1 follow-up, all attended today.
    await seedVisit(prisma, { ...common, checkedInAt: now });
    await seedVisit(prisma, { ...common, checkedInAt: now });
    await seedVisit(prisma, {
      ...common,
      appointmentType: 'FOLLOW_UP',
      checkedInAt: now,
    });
    // Previous month: 1 attended visit.
    await seedVisit(prisma, { ...common, checkedInAt: lastMonth });
    // Never attended (no check-in) — must be excluded entirely.
    await seedVisit(prisma, { ...common, checkedInAt: null });

    const auth = bearer(await loginAs(app, a.ownerEmail));
    const res = await auth(request(http()).get(branchStats(a.branch.id))).expect(
      200,
    );

    const data = res.body.data;
    expect(data.visits).toEqual({ current: 2, previous: 1 });
    expect(data.follow_ups).toEqual({ current: 1, previous: 0 });
    expect(data.total).toEqual({ current: 3, previous: 1 });

    // All three current-month check-ins are today → a single daily bucket.
    expect(data.daily).toHaveLength(1);
    expect(data.daily[0]).toMatchObject({ visits: 2, follow_ups: 1 });
  });

  it('is scoped to the branch in the path', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'doc.a@example.com');
    const branch2 = await prisma.branch.create({
      data: {
        organization_id: a.org.id,
        name: 'Second',
        address: '2 St',
        city: 'Cairo',
        governorate: 'Cairo',
      },
    });
    await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      status: 'COMPLETED',
      checkedInAt: now,
    });
    await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: branch2.id,
      doctorProfileId: a.ownerProfileId,
      status: 'COMPLETED',
      checkedInAt: now,
    });

    const auth = bearer(await loginAs(app, a.ownerEmail));
    const res = await auth(
      request(http()).get(branchStats(branch2.id)),
    ).expect(200);

    // Only branch2's single visit — branch1's must not leak.
    expect(res.body.data.total.current).toBe(1);
  });

  it('org-wide endpoint aggregates across the org branches', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'doc.a@example.com');
    const branch2 = await prisma.branch.create({
      data: {
        organization_id: a.org.id,
        name: 'Second',
        address: '2 St',
        city: 'Cairo',
        governorate: 'Cairo',
      },
    });
    await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      status: 'COMPLETED',
      checkedInAt: now,
    });
    await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: branch2.id,
      doctorProfileId: a.ownerProfileId,
      status: 'COMPLETED',
      checkedInAt: now,
    });

    const auth = bearer(await loginAs(app, a.ownerEmail));
    const res = await auth(request(http()).get(orgStats(a.org.id))).expect(200);

    // Both branches counted org-wide.
    expect(res.body.data.total.current).toBe(2);
  });

  it('does not leak across tenants', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'doc.a@example.com');
    const b = await seedOrg(prisma, 'Clinic B', 'doc.b@otherorg.com');
    await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      status: 'COMPLETED',
      checkedInAt: now,
    });

    // Org B owner querying org A's branch path is forbidden (not their branch).
    const auth = bearer(await loginAs(app, b.ownerEmail));
    await auth(request(http()).get(branchStats(a.branch.id))).expect(403);
  });
});
