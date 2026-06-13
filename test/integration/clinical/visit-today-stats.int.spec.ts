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
 * `GET /branches/:branchId/visits/today-stats` against real Postgres. The
 * endpoint reports today's (or `?date=`) operational counts — clinical visits
 * split by appointment type plus medical-rep visits — counted by `scheduled_at`
 * within the day's bounds, regardless of status. `assigned_to_me=true` narrows to
 * the current doctor's own queue.
 */
describe('Visits — today stats (integration)', () => {
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
  const todayStats = (branchId: string) =>
    `/v1/branches/${branchId}/visits/today-stats`;

  const now = new Date();
  // A day safely outside today (mid previous month).
  const otherDay = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);

  /** Seed a medical-rep visit (creates the owning rep) scheduled at `when`. */
  async function seedRepVisit(args: {
    organizationId: string;
    branchId: string;
    doctorProfileId: string;
    when: Date;
  }) {
    const rep = await prisma.medicalRep.create({
      data: {
        organization_id: args.organizationId,
        full_name: 'Rep One',
        company_name: 'Pharma Co',
      },
    });
    await prisma.medicalRepVisit.create({
      data: {
        medical_rep_id: rep.id,
        organization_id: args.organizationId,
        branch_id: args.branchId,
        assigned_doctor_id: args.doctorProfileId,
        created_by_id: args.doctorProfileId,
        scheduled_at: args.when,
      },
    });
  }

  it("counts today's visits by type plus medical reps, excluding other days", async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'doc.a@example.com');
    const common = {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      status: 'SCHEDULED' as const,
    };

    // Today: 2 visits + 1 follow-up (scheduled_at defaults to now).
    await seedVisit(prisma, common);
    await seedVisit(prisma, common);
    await seedVisit(prisma, { ...common, appointmentType: 'FOLLOW_UP' });
    // Today: 1 medical-rep visit.
    await seedRepVisit({
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      when: now,
    });
    // Other day — must be excluded from both clinical and rep counts.
    await seedVisit(prisma, { ...common, scheduledAt: otherDay });
    await seedRepVisit({
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      when: otherDay,
    });

    const auth = bearer(await loginAs(app, a.ownerEmail));
    const res = await auth(request(http()).get(todayStats(a.branch.id))).expect(
      200,
    );

    expect(res.body.data).toMatchObject({
      visits: 2,
      follow_ups: 1,
      total_visits: 3,
      medical_reps: 1,
    });
  });

  it('assigned_to_me scopes counts to the current doctor', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'doc.a@example.com');

    // A second doctor profile in the same org (no login needed for it).
    const otherUser = await prisma.user.create({
      data: {
        first_name: 'Doc',
        last_name: 'Two',
        email: 'doc.two@example.com',
        password_hashed: 'x',
        is_active: true,
        verified_at: new Date(),
        registration_status: 'ACTIVE',
        onboarding_completed: true,
      },
    });
    const ownerRole = await prisma.role.findFirstOrThrow({
      where: { code: 'OWNER' },
    });
    const otherProfile = await prisma.profile.create({
      data: {
        user_id: otherUser.id,
        organization_id: a.org.id,
        engagement_type: 'FULL_TIME',
        roles: { create: [{ role_id: ownerRole.id }] },
      },
    });

    // One visit for the owner, one for the other doctor — both today.
    await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      status: 'SCHEDULED',
    });
    await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: otherProfile.id,
      status: 'SCHEDULED',
    });

    const auth = bearer(await loginAs(app, a.ownerEmail));

    // Whole branch: both visits.
    const all = await auth(request(http()).get(todayStats(a.branch.id))).expect(
      200,
    );
    expect(all.body.data.total_visits).toBe(2);

    // assigned_to_me: only the owner's own visit.
    const mine = await auth(
      request(http())
        .get(todayStats(a.branch.id))
        .query({ assigned_to_me: 'true' }),
    ).expect(200);
    expect(mine.body.data.total_visits).toBe(1);
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
      status: 'SCHEDULED',
    });
    await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: branch2.id,
      doctorProfileId: a.ownerProfileId,
      status: 'SCHEDULED',
    });

    const auth = bearer(await loginAs(app, a.ownerEmail));
    const res = await auth(request(http()).get(todayStats(branch2.id))).expect(
      200,
    );

    // Only branch2's visit — branch1's must not leak.
    expect(res.body.data.total_visits).toBe(1);
  });

  it('does not leak across tenants', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'doc.a@example.com');
    const b = await seedOrg(prisma, 'Clinic B', 'doc.b@otherorg.com');
    await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      status: 'SCHEDULED',
    });

    // Org B owner querying org A's branch path is forbidden (not their branch).
    const auth = bearer(await loginAs(app, b.ownerEmail));
    await auth(request(http()).get(todayStats(a.branch.id))).expect(403);
  });
});
