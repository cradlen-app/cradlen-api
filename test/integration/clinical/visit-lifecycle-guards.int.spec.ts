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
import { bearer, loginAndSelect, seedMember } from '../../helpers/auth-helpers';
import {
  loginAs,
  seedOrg,
  seedReceptionist,
} from '../../helpers/financial-helpers';
import { seedVisit } from '../../helpers/visits-helpers';

/**
 * Visit lifecycle integrity guards against real Postgres.
 *
 * The workflow is: reception books → reception drives the queue (CHECKED_IN,
 * IN_PROGRESS) → the *assigned* doctor starts the consultation (IN_CONSULTATION)
 * → the *assigned* doctor completes. Once COMPLETED a visit is terminal. These
 * tests pin the server-side enforcement of *who* may drive each step, and that
 * the only way a visit is created is via booking (the episode-scoped "create"
 * bypass route is gone).
 */
describe('Visits — lifecycle integrity guards (integration)', () => {
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
  const statusUrl = (id: string) => `/v1/visits/${id}/status`;

  it('the bypass create route (POST /episodes/:id/visits) no longer exists', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    await auth(
      request(http()).post(`/v1/episodes/${randomUUID()}/visits`).send({
        assigned_doctor_id: a.ownerProfileId,
        appointment_type: 'VISIT',
        priority: 'NORMAL',
        scheduled_at: new Date().toISOString(),
      }),
    ).expect(404);
  });

  // Note: the "non-reception cannot book" guard is exercised at the unit level
  // (visits.service.spec.ts) — over HTTP the global ValidationPipe rejects an
  // incomplete BookVisitDto with 400 before the handler/guard runs, so a clean
  // 403 assertion isn't reachable without a full valid booking payload.

  it('a staff member who is not the assigned doctor cannot start the consultation', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'owner.a@example.com');
    const doctor = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: 'doctor@example.com',
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: 'intruder@example.com',
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const visit = await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: doctor.profileId,
      createdById: a.ownerProfileId,
      status: 'IN_PROGRESS',
    });

    const intruderTokens = await loginAndSelect(app, 'intruder@example.com');
    await bearer(intruderTokens.accessToken)(
      request(http()).patch(statusUrl(visit.visitId)).send({
        status: 'IN_CONSULTATION',
      }),
    ).expect(403);
  });

  it('the assigned doctor can start the consultation on their own visit', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'owner.a@example.com');
    const doctor = await seedMember(prisma, {
      orgId: a.org.id,
      branchId: a.branch.id,
      email: 'doctor@example.com',
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const visit = await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: doctor.profileId,
      createdById: a.ownerProfileId,
      status: 'IN_PROGRESS',
    });

    const doctorTokens = await loginAndSelect(app, 'doctor@example.com');
    const res = await bearer(doctorTokens.accessToken)(
      request(http()).patch(statusUrl(visit.visitId)).send({
        status: 'IN_CONSULTATION',
      }),
    ).expect(200);
    expect(res.body.data.status).toBe('IN_CONSULTATION');
  });

  it('a receptionist can check a scheduled visit in (reception-driven action)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'owner.a@example.com');
    await seedReceptionist(
      prisma,
      a.org.id,
      a.branch.id,
      'reception@example.com',
    );
    const visit = await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      createdById: a.ownerProfileId,
      status: 'SCHEDULED',
    });

    const reception = await loginAndSelect(app, 'reception@example.com');
    const res = await bearer(reception.accessToken)(
      request(http()).patch(statusUrl(visit.visitId)).send({
        status: 'CHECKED_IN',
      }),
    ).expect(200);
    expect(res.body.data.status).toBe('CHECKED_IN');
  });

  it('a receptionist can move a checked-in visit into the queue (IN_PROGRESS)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'owner.a@example.com');
    await seedReceptionist(
      prisma,
      a.org.id,
      a.branch.id,
      'reception@example.com',
    );
    const visit = await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      createdById: a.ownerProfileId,
      status: 'CHECKED_IN',
    });

    const reception = await loginAndSelect(app, 'reception@example.com');
    const res = await bearer(reception.accessToken)(
      request(http()).patch(statusUrl(visit.visitId)).send({
        status: 'IN_PROGRESS',
      }),
    ).expect(200);
    expect(res.body.data.status).toBe('IN_PROGRESS');
  });

  it('a receptionist cannot start the consultation (IN_CONSULTATION is doctor-only)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'owner.a@example.com');
    await seedReceptionist(
      prisma,
      a.org.id,
      a.branch.id,
      'reception@example.com',
    );
    const visit = await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      createdById: a.ownerProfileId,
      status: 'IN_PROGRESS',
    });

    const reception = await loginAndSelect(app, 'reception@example.com');
    await bearer(reception.accessToken)(
      request(http()).patch(statusUrl(visit.visitId)).send({
        status: 'IN_CONSULTATION',
      }),
    ).expect(403);
  });

  it('a COMPLETED visit cannot be reopened (terminal transition)', async () => {
    const a = await seedOrg(prisma, 'Clinic A', 'owner.a@example.com');
    const visit = await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      status: 'COMPLETED',
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    // Even an owner (privileged) cannot move a terminal visit back to IN_PROGRESS.
    const auth = bearer(await loginAs(app, a.ownerEmail));
    await auth(
      request(http()).patch(statusUrl(visit.visitId)).send({
        status: 'IN_PROGRESS',
      }),
    ).expect(400);
  });
});
