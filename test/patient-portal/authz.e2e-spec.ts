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
 * Object-level authorization (IDOR) regression suite for the patient portal.
 *
 * The Next.js portal attaches the patient's bearer token and proxies straight
 * to `/v1/patient-portal/*` — it performs NO ownership checks of its own, so the
 * backend is the sole authority. These tests prove that authority holds:
 *   - a patient cannot read another patient's data by passing `?patient_id=<other>`
 *   - a guardian sees only currently-linked patients, and a revoked link takes
 *     effect immediately (the JWT strategy re-resolves accessible patients per
 *     request, so a still-valid token loses access the moment the link is soft
 *     deleted).
 */
/**
 * patients / guardians / patient_guardians are not in the shared cleaner's
 * table list. Truncate them with a bounded retry: Neon's pooler intermittently
 * fails to start the implicit transaction under load ("Unable to start a
 * transaction in the given time"), and TRUNCATE can also hit a transient lock
 * (40P01 / 55P03) against the app's background writes. Retry with growing
 * backoff so a transient blip clears deterministically without masking a real
 * failure. Mirrors the approach in test/helpers/db-cleaner.ts.
 */
async function truncatePatientTables(): Promise<void> {
  const client = getTestPrisma() as unknown as {
    $executeRawUnsafe: (sql: string) => Promise<unknown>;
  };
  const MAX_ATTEMPTS = 8;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await client.$executeRawUnsafe(
        'TRUNCATE TABLE "patient_guardians", "guardians", "patients" CASCADE',
      );
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1500, 200 * attempt)),
      );
    }
  }
  throw lastError;
}

let seq = 0;
function nextIdentity(): { national_id: string; phone_number: string } {
  seq += 1;
  return {
    national_id: `2900520020${1000 + seq}`,
    phone_number: `+201020${(100000 + seq).toString()}`,
  };
}

describe('Patient portal object-level authorization (E2E)', () => {
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
    // Clear patient tables (separate from the shared cleaner) so national_id
    // uniqueness holds across tests.
    await truncatePatientTables();
    // Reset the per-route rate-limit counters so signup/start (5 per window)
    // never accumulates across tests into spurious 429s.
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

  /** Seeds a patient, runs the real signup flow, and returns its access token. */
  async function registerPatient() {
    const identity = nextIdentity();
    const patient = await seedPatient(identity);
    const start = await http()
      .post('/v1/patient-auth/signup/start')
      .send({ ...identity, date_of_birth: DOB })
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
    return { patient, token: complete.body.data.access_token as string };
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  describe('a patient cannot reach another patient via ?patient_id', () => {
    it('profile -> 404', async () => {
      const a = await registerPatient();
      const b = await registerPatient();

      // Sanity: A can read its OWN profile (so a 404 below is authz, not a
      // blanket failure).
      await http()
        .get('/v1/patient-portal/profile')
        .set(auth(a.token))
        .expect(200);

      await http()
        .get(`/v1/patient-portal/profile?patient_id=${b.patient.id}`)
        .set(auth(a.token))
        .expect(404);
    });

    it('investigations -> 404', async () => {
      const a = await registerPatient();
      const b = await registerPatient();

      await http()
        .get(`/v1/patient-portal/investigations?patient_id=${b.patient.id}`)
        .set(auth(a.token))
        .expect(404);
    });

    it('visits -> 404', async () => {
      const a = await registerPatient();
      const b = await registerPatient();

      await http()
        .get(`/v1/patient-portal/visits?patient_id=${b.patient.id}`)
        .set(auth(a.token))
        .expect(404);
    });

    it('journey -> 404', async () => {
      const a = await registerPatient();
      const b = await registerPatient();

      await http()
        .get(`/v1/patient-portal/journey?patient_id=${b.patient.id}`)
        .set(auth(a.token))
        .expect(404);
    });

    it('updating profile for another patient -> 404 (no write-side IDOR)', async () => {
      const a = await registerPatient();
      const b = await registerPatient();

      await http()
        .patch(`/v1/patient-portal/profile?patient_id=${b.patient.id}`)
        .set(auth(a.token))
        .send({ address: 'Hacked St' })
        .expect(404);

      // B's record is untouched.
      const bRecord = await getTestPrisma().patient.findUniqueOrThrow({
        where: { id: b.patient.id },
      });
      expect(bRecord.address).toBe('1 Clinic St');
    });
  });

  describe('guardian access is gated by the link and revocation is immediate', () => {
    async function registerGuardianFor(patientId: string) {
      const identity = nextIdentity();
      const guardian = await getTestPrisma().guardian.create({
        data: {
          national_id: identity.national_id,
          full_name: 'Omar Ali',
          phone_number: identity.phone_number,
          date_of_birth: new Date('1985-03-15'),
        },
      });
      await getTestPrisma().patientGuardian.create({
        data: {
          patient_id: patientId,
          guardian_id: guardian.id,
          relation_to_patient: 'SPOUSE',
          is_primary: true,
        },
      });
      const start = await http()
        .post('/v1/patient-auth/signup/start')
        .send({ ...identity, date_of_birth: '1985-03-15' })
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
      return { guardian, token: complete.body.data.access_token as string };
    }

    it('linked guardian can read the patient; revoking the link blocks it on the same token', async () => {
      const patientIdentity = nextIdentity();
      const patient = await seedPatient(patientIdentity);
      const g = await registerGuardianFor(patient.id);

      // While linked: the guardian's accessible set contains the patient, and
      // it can read that patient's profile.
      const meLinked = await http()
        .get('/v1/patient-auth/me')
        .set(auth(g.token))
        .expect(200);
      expect(meLinked.body.data.accessible_patient_ids).toEqual([patient.id]);

      await http()
        .get(`/v1/patient-portal/profile?patient_id=${patient.id}`)
        .set(auth(g.token))
        .expect(200);

      // Revoke the link (soft delete) — no new token is issued.
      await getTestPrisma().patientGuardian.updateMany({
        where: { guardian_id: g.guardian.id, patient_id: patient.id },
        data: { is_deleted: true, deleted_at: new Date() },
      });

      // The SAME token is now re-resolved against the DB: access is gone.
      const meRevoked = await http()
        .get('/v1/patient-auth/me')
        .set(auth(g.token))
        .expect(200);
      expect(meRevoked.body.data.accessible_patient_ids).toEqual([]);

      await http()
        .get(`/v1/patient-portal/profile?patient_id=${patient.id}`)
        .set(auth(g.token))
        .expect(404);
    });
  });
});
