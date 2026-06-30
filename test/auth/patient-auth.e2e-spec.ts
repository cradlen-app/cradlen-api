import { INestApplication } from '@nestjs/common';
import {
  ThrottlerStorage,
  type ThrottlerStorageOptions,
} from '@nestjs/throttler';
import request from 'supertest';
import { createTestApp } from '../helpers/app-factory';
import { cleanDatabase } from '../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../helpers/prisma-test-client';

const PASSWORD = 'Password1!';
const DOB = '1990-05-20';

/**
 * Each test uses a fresh national_id + phone so the per-identifier throttle
 * buckets (keyed by national_id on login, phone_number on signup/start) never
 * collide across tests. The suite also keeps total signup/complete calls under
 * the route's 5-per-window cap.
 */
let seq = 0;
function nextIdentity(): { national_id: string; phone_number: string } {
  seq += 1;
  return {
    national_id: `2900520010${1000 + seq}`,
    phone_number: `+201010${(100000 + seq).toString()}`,
  };
}

describe('Patient self-signup and login (E2E)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;

  beforeAll(async () => {
    mailMock = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp(mailMock);
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestPrisma();
  });

  beforeEach(async () => {
    await cleanDatabase(getTestPrisma());
    // patients/guardians/patient_guardians are not in the shared cleaner's
    // table list (it focuses on tenant/auth tables) — clear them here so
    // national_id uniqueness holds across tests.
    await (
      getTestPrisma() as unknown as {
        $executeRawUnsafe: (sql: string) => Promise<unknown>;
      }
    ).$executeRawUnsafe(
      'TRUNCATE TABLE "patient_guardians", "guardians", "patients" CASCADE',
    );
    // Reset the in-memory rate-limit counters between tests. The patient auth
    // routes carry a strict per-route cap (signup/start is 5 per 10-min window
    // on the IP-only global throttler), which would otherwise accumulate across
    // the suite and surface as spurious 429s.
    app
      .get<{ storage: Map<string, ThrottlerStorageOptions> }>(ThrottlerStorage)
      .storage.clear();
  });

  function http() {
    return request(app.getHttpServer());
  }

  function seedPatient(identity: {
    national_id: string;
    phone_number: string;
  }) {
    return getTestPrisma().patient.create({
      data: {
        national_id: identity.national_id,
        full_name: 'Sara Ali',
        date_of_birth: new Date(DOB),
        phone_number: identity.phone_number,
        address: '1 Clinic St',
      },
    });
  }

  it('patient: start -> complete (auto-login) -> me -> login, and staff routes reject the token', async () => {
    const identity = nextIdentity();
    const patient = await seedPatient(identity);

    const start = await http()
      .post('/v1/patient-auth/signup/start')
      .send({ ...identity, date_of_birth: DOB })
      .expect(200);
    expect(start.body.data.patient_signup_token).toEqual(expect.any(String));

    const complete = await http()
      .post('/v1/patient-auth/signup/complete')
      .send({
        patient_signup_token: start.body.data.patient_signup_token,
        password: PASSWORD,
        confirm_password: PASSWORD,
        security_question: 'BIRTH_CITY',
        security_answer: 'Cairo',
      })
      .expect(201);
    expect(complete.body.data.type).toBe('tokens');
    const accessToken = complete.body.data.access_token as string;
    const refreshToken = complete.body.data.refresh_token as string;
    expect(accessToken).toEqual(expect.any(String));
    expect(refreshToken).toEqual(expect.any(String));

    // A PatientAccount is created linked to the patient — never a staff `users`
    // row (no Profile exists, and no patient row leaked into `users`).
    const account = await getTestPrisma().patientAccount.findFirstOrThrow({
      where: { patient_id: patient.id },
    });
    expect(account.is_active).toBe(true);
    expect(await getTestPrisma().profile.count()).toBe(0);
    expect(
      await getTestPrisma().user.count({ where: { id: account.id } }),
    ).toBe(0);

    const me = await http()
      .get('/v1/patient-auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body.data).toEqual({
      user_id: account.id,
      patient_id: patient.id,
      guardian_id: null,
      accessible_patient_ids: [patient.id],
      display_name: 'Sara Ali',
      security_question: 'BIRTH_CITY',
      accessible_patients: [
        {
          id: patient.id,
          full_name: 'Sara Ali',
          date_of_birth: DOB,
          relation: 'SELF',
          profile_image_url: null,
        },
      ],
    });

    // The patient token must NOT authenticate a staff route (wrong type).
    await http()
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);

    // Login by national_id + password returns a fresh token pair.
    const login = await http()
      .post('/v1/patient-auth/login')
      .send({ national_id: identity.national_id, password: PASSWORD })
      .expect(200);
    expect(login.body.data.type).toBe('tokens');

    // Wrong password -> generic 401.
    await http()
      .post('/v1/patient-auth/login')
      .send({ national_id: identity.national_id, password: 'WrongPass1!' })
      .expect(401);

    // Refresh rotates the pair into a new refresh token.
    const refreshed = await http()
      .post('/v1/patient-auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(200);
    expect(refreshed.body.data.type).toBe('tokens');
    const newRefresh = refreshed.body.data.refresh_token as string;
    expect(newRefresh).not.toBe(refreshToken);

    // The just-rotated token, reused *within* the reuse-grace window, is
    // honored (concurrent refreshes across instances must not kill an
    // otherwise-valid session) and returns a fresh pair.
    await http()
      .post('/v1/patient-auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(200);

    // Once the grace window has elapsed, reusing the rotated token is a replay
    // and is rejected. Backdate the revoked rows past the window rather than
    // waiting in real time.
    await getTestPrisma().refreshToken.updateMany({
      where: { patient_account_id: account.id, is_revoked: true },
      data: { revoked_at: new Date(Date.now() - 60_000) },
    });
    await http()
      .post('/v1/patient-auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(401);

    // Logout revokes the current refresh token.
    await http()
      .post('/v1/patient-auth/logout')
      .send({ refresh_token: newRefresh })
      .expect(204);
    await http()
      .post('/v1/patient-auth/refresh')
      .send({ refresh_token: newRefresh })
      .expect(401);
  });

  it('rejects a wrong date_of_birth or phone with a generic 404, and mismatched passwords with 400', async () => {
    const identity = nextIdentity();
    await seedPatient(identity);

    await http()
      .post('/v1/patient-auth/signup/start')
      .send({ ...identity, date_of_birth: '1991-01-01' })
      .expect(404);

    await http()
      .post('/v1/patient-auth/signup/start')
      .send({
        national_id: identity.national_id,
        date_of_birth: DOB,
        phone_number: '+209999999999',
      })
      .expect(404);

    const start = await http()
      .post('/v1/patient-auth/signup/start')
      .send({ ...identity, date_of_birth: DOB })
      .expect(200);

    await http()
      .post('/v1/patient-auth/signup/complete')
      .send({
        patient_signup_token: start.body.data.patient_signup_token,
        password: PASSWORD,
        confirm_password: 'Different1!',
      })
      .expect(400);
  });

  it('rejects a second signup once the account already exists (409)', async () => {
    const identity = nextIdentity();
    await seedPatient(identity);

    const start = await http()
      .post('/v1/patient-auth/signup/start')
      .send({ ...identity, date_of_birth: DOB })
      .expect(200);
    await http()
      .post('/v1/patient-auth/signup/complete')
      .send({
        patient_signup_token: start.body.data.patient_signup_token,
        password: PASSWORD,
        confirm_password: PASSWORD,
        security_question: 'BIRTH_CITY',
        security_answer: 'Cairo',
      })
      .expect(201);

    await http()
      .post('/v1/patient-auth/signup/start')
      .send({ ...identity, date_of_birth: DOB })
      .expect(409);
  });

  it('guardian: matches on national_id + dob + phone and /me lists guarded patients', async () => {
    const patientIdentity = nextIdentity();
    const guardianIdentity = nextIdentity();
    const patient = await seedPatient(patientIdentity);
    const guardian = await getTestPrisma().guardian.create({
      data: {
        national_id: guardianIdentity.national_id,
        full_name: 'Omar Ali',
        phone_number: guardianIdentity.phone_number,
        date_of_birth: new Date('1985-03-15'),
      },
    });
    await getTestPrisma().patientGuardian.create({
      data: {
        patient_id: patient.id,
        guardian_id: guardian.id,
        relation_to_patient: 'SPOUSE',
        is_primary: true,
      },
    });

    const start = await http()
      .post('/v1/patient-auth/signup/start')
      .send({ ...guardianIdentity, date_of_birth: '1985-03-15' })
      .expect(200);
    const complete = await http()
      .post('/v1/patient-auth/signup/complete')
      .send({
        patient_signup_token: start.body.data.patient_signup_token,
        password: PASSWORD,
        confirm_password: PASSWORD,
        security_question: 'BIRTH_CITY',
        security_answer: 'Cairo',
      })
      .expect(201);

    const me = await http()
      .get('/v1/patient-auth/me')
      .set('Authorization', `Bearer ${complete.body.data.access_token}`)
      .expect(200);
    expect(me.body.data.guardian_id).toBe(guardian.id);
    expect(me.body.data.patient_id).toBeNull();
    expect(me.body.data.accessible_patient_ids).toEqual([patient.id]);
    expect(me.body.data.display_name).toBe('Omar Ali');
    expect(me.body.data.accessible_patients).toEqual([
      {
        id: patient.id,
        full_name: 'Sara Ali',
        date_of_birth: DOB,
        relation: 'SPOUSE',
        profile_image_url: null,
      },
    ]);
  });

  it('login with a well-formed but unknown national_id returns a generic 401', async () => {
    await http()
      .post('/v1/patient-auth/login')
      .send({ national_id: '99999999999999', password: PASSWORD })
      .expect(401);
  });

  it('rejects a 13-digit national_id and a weak password with 400', async () => {
    const identity = nextIdentity();
    await seedPatient(identity);

    // 13 digits -> format validation fails before any lookup.
    await http()
      .post('/v1/patient-auth/signup/start')
      .send({
        national_id: '2900520010123',
        date_of_birth: DOB,
        phone_number: identity.phone_number,
      })
      .expect(400);

    const start = await http()
      .post('/v1/patient-auth/signup/start')
      .send({ ...identity, date_of_birth: DOB })
      .expect(200);

    // Weak password (no symbol/upper) -> strong-password validation fails.
    await http()
      .post('/v1/patient-auth/signup/complete')
      .send({
        patient_signup_token: start.body.data.patient_signup_token,
        password: 'password123',
        confirm_password: 'password123',
        security_question: 'BIRTH_CITY',
        security_answer: 'Cairo',
      })
      .expect(400);
  });
});
