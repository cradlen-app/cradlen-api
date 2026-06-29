import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';
import { seedOrg } from '../../helpers/financial-helpers';
import { seedVisit } from '../../helpers/visits-helpers';
import { createPatientAccount } from '../../helpers/patient-portal-helpers';

/**
 * Patient-portal read/write surfaces (PHI). Each route is authed via the live
 * `PatientJwtAuthGuard` and scoped to the token's accessible patient(s). This
 * covers the happy path for every portal surface plus the surface-level
 * ownership control (foreign `?patient_id=` → 404), complementing the dedicated
 * IDOR spec. Patients + the clinical graph are seeded directly via Prisma.
 */
describe('Patient portal — surfaces (integration)', () => {
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
    await (
      prisma as unknown as {
        $executeRawUnsafe: (sql: string) => Promise<unknown>;
      }
    ).$executeRawUnsafe(
      'TRUNCATE TABLE "patient_accounts", "patient_guardians", "guardians", "patients" CASCADE',
    );
    mailMock.mockClear();
  });

  const auth = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);
  const http = () => app.getHttpServer();

  /**
   * One clinic, one patient (with a COMPLETED visit + ACTIVE journey from
   * seedVisit) and a portal account, plus a second isolated patient/account to
   * attack with. Returns everything a surface test needs.
   */
  async function setup() {
    const clinic = await seedOrg(
      prisma,
      'Clinic',
      'owner.surfaces@example.com',
    );
    const a = await seedVisit(prisma, {
      organizationId: clinic.org.id,
      branchId: clinic.branch.id,
      doctorProfileId: clinic.ownerProfileId,
      status: 'COMPLETED',
      patientName: 'Alice Portal',
    });
    const b = await seedVisit(prisma, {
      organizationId: clinic.org.id,
      branchId: clinic.branch.id,
      doctorProfileId: clinic.ownerProfileId,
      status: 'COMPLETED',
      patientName: 'Bob Other',
    });
    const accA = await createPatientAccount(prisma, a.patientId);
    const accB = await createPatientAccount(prisma, b.patientId);
    return { clinic, a, b, accA, accB };
  }

  describe('profile', () => {
    it('GET returns the session patient own record', async () => {
      const { a, accA } = await setup();
      const res = await auth(
        request(http()).get('/v1/patient-portal/profile'),
        accA.token,
      ).expect(200);
      expect(res.body.data.id).toBe(a.patientId);
      expect(res.body.data.full_name).toBe('Alice Portal');
      // national_id is exposed read-only on the profile envelope.
      expect(typeof res.body.data.national_id).toBe('string');
    });

    it('PATCH updates a demographic field and it round-trips', async () => {
      const { accA } = await setup();
      const patched = await auth(
        request(http()).patch('/v1/patient-portal/profile'),
        accA.token,
      )
        .send({ address: '99 Updated Ave' })
        .expect(200);
      expect(patched.body.data.address).toBe('99 Updated Ave');

      const after = await auth(
        request(http()).get('/v1/patient-portal/profile'),
        accA.token,
      ).expect(200);
      expect(after.body.data.address).toBe('99 Updated Ave');
    });

    it('GET with a foreign patient_id is 404 (ownership)', async () => {
      const { b, accA } = await setup();
      await auth(
        request(http()).get(
          `/v1/patient-portal/profile?patient_id=${b.patientId}`,
        ),
        accA.token,
      ).expect(404);
    });
  });

  describe('medications', () => {
    it('GET returns the { current, past } envelope', async () => {
      const { accA } = await setup();
      const res = await auth(
        request(http()).get('/v1/patient-portal/medications'),
        accA.token,
      ).expect(200);
      // The portal medications surface is NOT paginated — it returns a split
      // CURRENT/PAST envelope (wrapped by the ResponseInterceptor under `data`).
      expect(Array.isArray(res.body.data.current)).toBe(true);
      expect(Array.isArray(res.body.data.past)).toBe(true);
    });

    it('GET with a foreign patient_id is 404 (ownership)', async () => {
      const { b, accA } = await setup();
      await auth(
        request(http()).get(
          `/v1/patient-portal/medications?patient_id=${b.patientId}`,
        ),
        accA.token,
      ).expect(404);
    });
  });

  describe('visits', () => {
    it('GET lists the patient COMPLETED visit', async () => {
      const { a, accA } = await setup();
      const res = await auth(
        request(http()).get('/v1/patient-portal/visits'),
        accA.token,
      ).expect(200);
      const ids = (res.body.data as Array<{ id: string }>).map((v) => v.id);
      expect(ids).toContain(a.visitId);
    });

    it('GET upcoming returns an array', async () => {
      const { accA } = await setup();
      const res = await auth(
        request(http()).get('/v1/patient-portal/visits/upcoming'),
        accA.token,
      ).expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET journeys/timeline contains the seeded journey', async () => {
      const { accA } = await setup();
      const res = await auth(
        request(http()).get('/v1/patient-portal/visits/journeys/timeline'),
        accA.token,
      ).expect(200);
      const items = res.body.data as Array<{
        id: string;
        episodes: unknown[];
      }>;
      expect(items.length).toBeGreaterThan(0);
      expect(Array.isArray(items[0].episodes)).toBe(true);
    });

    it('GET with a foreign patient_id is 404 (ownership)', async () => {
      const { b, accA } = await setup();
      await auth(
        request(http()).get(
          `/v1/patient-portal/visits?patient_id=${b.patientId}`,
        ),
        accA.token,
      ).expect(404);
    });
  });

  describe('journey descriptor', () => {
    it('GET returns the active journey or null without throwing', async () => {
      const { accA } = await setup();
      const res = await auth(
        request(http()).get('/v1/patient-portal/journey'),
        accA.token,
      ).expect(200);
      // seedVisit creates an ACTIVE journey but with no care_path, so the
      // descriptor resolves with null care-path fields and an ordered stage
      // list. (A patient with no active journey would yield `data: null`.)
      if (res.body.data !== null) {
        expect(res.body.data).toHaveProperty('journey_id');
        expect(res.body.data).toHaveProperty('status', 'ACTIVE');
        expect(Array.isArray(res.body.data.stages)).toBe(true);
      }
    });
  });

  describe('notifications', () => {
    /** Seed a patient_notifications row for the given patient + org. */
    async function seedNotification(
      patientId: string,
      organizationId: string,
    ): Promise<string> {
      const row = await prisma.patientNotification.create({
        data: {
          patient_id: patientId,
          organization_id: organizationId,
          code: 'INVESTIGATION_RESULT_READY',
          category: 'CLINICAL',
          title: 'Your results are ready',
          description: 'Your CBC results have been published.',
        },
      });
      return row.id;
    }

    it('GET lists the seeded notification with an unread rollup', async () => {
      const { clinic, a, accA } = await setup();
      const id = await seedNotification(a.patientId, clinic.org.id);
      const res = await auth(
        request(http()).get('/v1/patient-portal/notifications'),
        accA.token,
      ).expect(200);
      const ids = (res.body.data as Array<{ id: string }>).map((n) => n.id);
      expect(ids).toContain(id);
      expect(res.body.meta.unreadCount).toBeGreaterThanOrEqual(1);
    });

    it('PATCH :id/read marks a notification read', async () => {
      const { clinic, a, accA } = await setup();
      const id = await seedNotification(a.patientId, clinic.org.id);
      const res = await auth(
        request(http()).patch(`/v1/patient-portal/notifications/${id}/read`),
        accA.token,
      ).expect(200);
      expect(res.body.data.is_read).toBe(true);

      const stored = await prisma.patientNotification.findUniqueOrThrow({
        where: { id },
      });
      expect(stored.is_read).toBe(true);
      expect(stored.read_at).not.toBeNull();
    });

    it('PATCH read-all marks every notification read (204)', async () => {
      const { clinic, a, accA } = await setup();
      await seedNotification(a.patientId, clinic.org.id);
      await seedNotification(a.patientId, clinic.org.id);
      await auth(
        request(http()).patch('/v1/patient-portal/notifications/read-all'),
        accA.token,
      ).expect(204);

      const unread = await prisma.patientNotification.count({
        where: { patient_id: a.patientId, is_read: false, is_deleted: false },
      });
      expect(unread).toBe(0);
    });

    it("does not surface another patient's notifications", async () => {
      const { clinic, b, accA } = await setup();
      await seedNotification(b.patientId, clinic.org.id);
      const res = await auth(
        request(http()).get('/v1/patient-portal/notifications'),
        accA.token,
      ).expect(200);
      expect((res.body.data as unknown[]).length).toBe(0);
    });
  });
});
