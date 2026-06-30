import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
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
  // In-memory throttle counts persist across tests; clearing them per test keeps
  // the per-IP signup/start cap (5/10min) from bleeding across the suite's
  // signups (the global ThrottlerGuard buckets by IP, which is constant here).
  let throttleStorage: ThrottlerStorage & { storage: Map<string, unknown> };

  beforeAll(async () => {
    mailMock = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp(mailMock);
    prisma = getTestPrisma();
    throttleStorage = app.get<ThrottlerStorage>(
      ThrottlerStorage,
    ) as ThrottlerStorage & { storage: Map<string, unknown> };
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
    throttleStorage.storage.clear();
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

  /**
   * A unique 11-digit phone per signup. The IdentifierThrottlerGuard buckets
   * signup/start by `${ip}:${phone_number}` (phone is resolved before
   * national_id), so a shared phone would funnel every test's signup into one
   * 5-per-10-min bucket and trip a 429. Pairing the phone with `idCounter`
   * keeps each signup in its own bucket.
   */
  function uniquePhone(): string {
    return `0${1099887766 + idCounter}`;
  }

  const DOB = '1990-05-20';
  const PHONE = '01099887766';
  const PASSWORD = 'Password1!';

  /** Seed a Patient on file (the identity the portal matches against). */
  async function seedPatientOnFile(
    nationalId: string,
    phone: string = PHONE,
  ): Promise<{ patientId: string }> {
    const patient = await prisma.patient.create({
      data: {
        national_id: nationalId,
        full_name: 'On-File Patient',
        date_of_birth: new Date(DOB),
        phone_number: phone,
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
    const phone = uniquePhone();
    await seedPatientOnFile(nationalId, phone);

    const start = await request(http())
      .post('/v1/patient-auth/signup/start')
      .send({
        national_id: nationalId,
        date_of_birth: DOB,
        phone_number: phone,
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

  it('refresh rotates the token to a fresh, working pair', async () => {
    const { refreshToken } = await signupPatient();

    const refreshed = await request(http())
      .post('/v1/patient-auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(200);
    const newRefresh = refreshed.body.data.refresh_token as string;
    expect(typeof refreshed.body.data.access_token).toBe('string');
    expect(newRefresh).not.toBe(refreshToken);

    // The new refresh token works.
    await request(http())
      .post('/v1/patient-auth/refresh')
      .send({ refresh_token: newRefresh })
      .expect(200);
  });

  it('tolerates reuse of a just-rotated token within the grace window (re-issues)', async () => {
    const { refreshToken } = await signupPatient();

    await request(http())
      .post('/v1/patient-auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(200);

    // Immediately reusing the rotated token is the concurrent-rotation case:
    // it must NOT 401 the session — a fresh pair is issued instead.
    const reused = await request(http())
      .post('/v1/patient-auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(200);
    expect(typeof reused.body.data.refresh_token).toBe('string');
  });

  it('rejects reuse of a token rotated beyond the grace window (401)', async () => {
    const { refreshToken } = await signupPatient();

    await request(http())
      .post('/v1/patient-auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(200);

    // Backdate the rotated row's revocation past the grace window → genuine reuse.
    await prisma.refreshToken.updateMany({
      where: { is_revoked: true },
      data: { revoked_at: new Date(Date.now() - 60_000) },
    });

    await request(http())
      .post('/v1/patient-auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(401);
  });

  it('two concurrent refreshes with the same token both succeed (no spurious 401)', async () => {
    const { refreshToken } = await signupPatient();

    const [a, b] = await Promise.all([
      request(http())
        .post('/v1/patient-auth/refresh')
        .send({ refresh_token: refreshToken }),
      request(http())
        .post('/v1/patient-auth/refresh')
        .send({ refresh_token: refreshToken }),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(typeof a.body.data.access_token).toBe('string');
    expect(typeof b.body.data.access_token).toBe('string');
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
