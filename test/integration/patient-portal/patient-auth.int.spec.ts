import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';

/**
 * Patient-portal self-service auth over HTTP. Unlike staff signup, patient
 * registration is OTP-free: identity is proven by matching
 * national_id + date_of_birth + phone_number against an existing Patient row
 * already on file at the clinic (see PatientSignupService.matchSubject). So each
 * test seeds a bare Patient row, then drives signup-start → complete → login →
 * refresh → change-password through the real controllers + PatientJwtAuthGuard.
 *
 * These routes carry explicit @Throttle windows, so each test uses a unique
 * national_id and keeps the number of calls modest.
 */
describe('Patient portal — auth (integration)', () => {
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

  const http = () => app.getHttpServer();
  const auth = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);

  let idCounter = 0;
  /** A unique 14-digit national id per test so the per-identifier throttle never collides. */
  function uniqueNationalId(): string {
    idCounter += 1;
    return String(29000000000000 + idCounter);
  }

  const DOB = '1990-05-20';
  const PHONE = '01099887766';
  const PASSWORD = 'Password1!';

  /** Seed a Patient on file (the identity the portal matches against). */
  async function seedPatientOnFile(
    nationalId: string,
  ): Promise<{ patientId: string }> {
    const patient = await prisma.patient.create({
      data: {
        national_id: nationalId,
        full_name: 'On-File Patient',
        date_of_birth: new Date(DOB),
        phone_number: PHONE,
        address: '5 Clinic St',
      },
    });
    return { patientId: patient.id };
  }

  /**
   * signup/start → signup/complete for a seeded on-file patient. Returns the
   * issued token pair (access + refresh) and the national id used.
   */
  async function signupPatient(): Promise<{
    nationalId: string;
    accessToken: string;
    refreshToken: string;
  }> {
    const nationalId = uniqueNationalId();
    await seedPatientOnFile(nationalId);

    const start = await request(http())
      .post('/v1/patient-auth/signup/start')
      .send({
        national_id: nationalId,
        date_of_birth: DOB,
        phone_number: PHONE,
      })
      .expect(200);
    const signupToken = start.body.data.patient_signup_token as string;
    expect(typeof signupToken).toBe('string');

    const complete = await request(http())
      .post('/v1/patient-auth/signup/complete')
      .send({
        patient_signup_token: signupToken,
        password: PASSWORD,
        confirm_password: PASSWORD,
        security_question: 'BIRTH_CITY',
        security_answer: 'Cairo',
      })
      .expect(201);

    return {
      nationalId,
      accessToken: complete.body.data.access_token as string,
      refreshToken: complete.body.data.refresh_token as string,
    };
  }

  it('signup start → complete issues an access + refresh token pair', async () => {
    const { accessToken, refreshToken } = await signupPatient();
    expect(typeof accessToken).toBe('string');
    expect(typeof refreshToken).toBe('string');
  });

  it('login returns tokens for a registered patient', async () => {
    const { nationalId } = await signupPatient();
    const login = await request(http())
      .post('/v1/patient-auth/login')
      .send({ national_id: nationalId, password: PASSWORD })
      .expect(200);
    expect(typeof login.body.data.access_token).toBe('string');
    expect(typeof login.body.data.refresh_token).toBe('string');
  });

  it('GET /me returns the patient identity for a valid access token', async () => {
    const { accessToken } = await signupPatient();
    const me = await auth(
      request(http()).get('/v1/patient-auth/me'),
      accessToken,
    ).expect(200);
    expect(me.body.data.patient_id).toBeTruthy();
    expect(me.body.data.guardian_id).toBeNull();
    expect(Array.isArray(me.body.data.accessible_patient_ids)).toBe(true);
    expect(me.body.data.accessible_patient_ids).toContain(
      me.body.data.patient_id,
    );
  });

  it('refresh rotates the token; reusing the old refresh token is rejected (401)', async () => {
    const { refreshToken } = await signupPatient();

    const refreshed = await request(http())
      .post('/v1/patient-auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(200);
    const newRefresh = refreshed.body.data.refresh_token as string;
    expect(typeof refreshed.body.data.access_token).toBe('string');
    expect(newRefresh).not.toBe(refreshToken);

    // The new refresh token works...
    await request(http())
      .post('/v1/patient-auth/refresh')
      .send({ refresh_token: newRefresh })
      .expect(200);

    // ...but the original (now-rotated) refresh token is dead (JTI rotation).
    await request(http())
      .post('/v1/patient-auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(401);
  });

  it('change-password updates the credential; new password works, old fails', async () => {
    const { nationalId, accessToken } = await signupPatient();
    const NEW_PASSWORD = 'Password2!';

    await auth(
      request(http()).post('/v1/patient-auth/change-password'),
      accessToken,
    )
      .send({ current_password: PASSWORD, new_password: NEW_PASSWORD })
      .expect(204);

    // New password authenticates.
    await request(http())
      .post('/v1/patient-auth/login')
      .send({ national_id: nationalId, password: NEW_PASSWORD })
      .expect(200);

    // Old password is rejected with the generic invalid-credentials 401.
    await request(http())
      .post('/v1/patient-auth/login')
      .send({ national_id: nationalId, password: PASSWORD })
      .expect(401);
  });
});
