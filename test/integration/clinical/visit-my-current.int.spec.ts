import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';
import { bearer, loginAndSelect, seedMember } from '../../helpers/auth-helpers';
import { loginAs, seedOrg } from '../../helpers/financial-helpers';
import { seedVisit } from '../../helpers/visits-helpers';

/**
 * `GET /branches/:branchId/visits/my-current` against real Postgres.
 *
 * Regression cover for the "doctor only sees their last in-progress visit" bug:
 * the endpoint must return EVERY IN_PROGRESS visit assigned to the caller today
 * (a `findMany`, not a `findFirst`), oldest first — and must not leak another
 * doctor's, another branch's, or another non-IN_PROGRESS visit.
 */
describe('Visits — my-current (integration)', () => {
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
  const myCurrent = (branchId: string) =>
    `/v1/branches/${branchId}/visits/my-current`;
  const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

  it("returns ALL of the doctor's in-progress visits, oldest first", async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'doc.a@example.com');
    const earlier = new Date(Date.now() - 60 * 60 * 1000);
    const later = new Date(Date.now() - 5 * 60 * 1000);

    // Seed the later one first to prove ordering is by started_at, not insert order.
    const late = await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      patientName: 'Late Patient',
      startedAt: later,
    });
    const early = await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      patientName: 'Early Patient',
      startedAt: earlier,
    });

    const auth = bearer(await loginAs(app, a.ownerEmail));
    const res = await auth(request(http()).get(myCurrent(a.branch.id))).expect(
      200,
    );

    expect(res.body.data).toHaveLength(2);
    expect(ids(res.body.data)).toEqual([early.visitId, late.visitId]);
  });

  it('excludes visits that are not IN_PROGRESS', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'doc.a@example.com');
    const inProgress = await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      status: 'IN_PROGRESS',
    });
    await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      status: 'CHECKED_IN',
    });
    await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      status: 'COMPLETED',
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    const auth = bearer(await loginAs(app, a.ownerEmail));
    const res = await auth(request(http()).get(myCurrent(a.branch.id))).expect(
      200,
    );

    expect(ids(res.body.data)).toEqual([inProgress.visitId]);
  });

  it('empty list when the doctor has no in-progress visits', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'doc.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    const res = await auth(request(http()).get(myCurrent(a.branch.id))).expect(
      200,
    );
    expect(res.body.data).toEqual([]);
  });

  // ── Security / isolation ────────────────────────────────────────────────

  it("does not leak another doctor's in-progress visit (assigned-doctor scoping)", async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'doc.a@example.com');
    const docB = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: 'doc.b@example.com',
      roleCode: 'STAFF',
      assignToBranch: true,
    });

    await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      createdById: a.ownerProfileId,
      patientName: "Doctor A's patient",
    });
    const bVisit = await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: docB.profileId,
      createdById: a.ownerProfileId,
      patientName: "Doctor B's patient",
    });

    const bTokens = await loginAndSelect(app, 'doc.b@example.com');
    const res = await bearer(bTokens.accessToken)(
      request(http()).get(myCurrent(a.branch.id)),
    ).expect(200);

    // Doctor B sees only their own visit, never doctor A's.
    expect(ids(res.body.data)).toEqual([bVisit.visitId]);
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
      patientName: 'Branch 1 patient',
    });

    const auth = bearer(await loginAs(app, a.ownerEmail));
    // Querying the OTHER branch returns nothing — the branch-1 visit must not leak.
    const res = await auth(request(http()).get(myCurrent(branch2.id))).expect(
      200,
    );
    expect(res.body.data).toEqual([]);
  });

  it('does not leak across tenants', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'doc.a@example.com');
    const b = await seedOrg(prisma, 'Clinic B', 'doc.b@otherorg.com');

    await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      patientName: 'Org A patient',
    });

    // Doctor from org B hits org A's branch path: no visits are theirs → empty.
    const auth = bearer(await loginAs(app, b.ownerEmail));
    const res = await auth(request(http()).get(myCurrent(a.branch.id))).expect(
      200,
    );
    expect(res.body.data).toEqual([]);
  });
});
