import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import type { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';
import { bearer } from '../../helpers/auth-helpers';
import { seedOrg } from '../../helpers/financial-helpers';
import { seedVisit } from '../../helpers/visits-helpers';

/**
 * Batch 2 — patient records + guardians.
 *
 * Patient records are org-gated: a staff member of one org cannot read or update
 * a patient that has no journey in their org (PatientAccessService → 404). The
 * patient master record itself is global, but per-org ACCESS is enforced here.
 *
 * Guardian lookup mirrors the global patient lookup: WITH a search term it
 * resolves guardians by name / national id across all orgs (full info, for
 * prefill), own-org first; WITHOUT a search term it returns only the caller's
 * own-org guardians.
 */
describe('Patient records + guardians (integration)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let prisma: PrismaClient;
  const jwt = new JwtService({});

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
      'TRUNCATE TABLE "patient_guardians", "guardians", "patients" CASCADE',
    );
    mailMock.mockClear();
  });

  const http = () => app.getHttpServer();

  async function ownerAuth(profileId: string, orgId: string) {
    const userId = (
      await prisma.profile.findUniqueOrThrow({
        where: { id: profileId },
        select: { user_id: true },
      })
    ).user_id;
    return bearer(
      jwt.sign(
        { userId, profileId, organizationId: orgId, type: 'access' },
        { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: '15m' },
      ),
    );
  }

  // Org A with a patient (journey in A) + a guardian linked to that patient.
  async function setup() {
    const a = await seedOrg(prisma, 'Org A', `a-${Date.now()}@ex.com`);
    const b = await seedOrg(prisma, 'Org B', `b-${Date.now()}@ex.com`);
    const { patientId } = await seedVisit(prisma, {
      organizationId: a.org.id,
      branchId: a.branch.id,
      doctorProfileId: a.ownerProfileId,
      status: 'IN_PROGRESS',
      patientName: 'Patient A',
    });
    const guardian = await prisma.guardian.create({
      data: {
        full_name: 'Khaled Guardian',
        national_id: 'GRD-12345678',
        phone_number: '+201111111111',
      },
    });
    await prisma.patientGuardian.create({
      data: {
        patient_id: patientId,
        guardian_id: guardian.id,
        relation_to_patient: 'PARENT',
      },
    });
    const authA = await ownerAuth(a.ownerProfileId, a.org.id);
    const authB = await ownerAuth(b.ownerProfileId, b.org.id);
    return { a, b, patientId, guardian, authA, authB };
  }

  // ---------- patient records: cross-org access ----------

  it('another org cannot read a patient outside its org (404)', async () => {
    const { patientId, authB } = await setup();
    await authB(request(http()).get(`/v1/patients/${patientId}`)).expect(404);
  });

  it('another org cannot update a patient outside its org (404)', async () => {
    const { patientId, authB } = await setup();
    await authB(request(http()).patch(`/v1/patients/${patientId}`))
      .send({ full_name: 'Hacked Name' })
      .expect(404);
  });

  it("the patient's own org can read the record (200)", async () => {
    const { patientId, authA } = await setup();
    const res = await authA(
      request(http()).get(`/v1/patients/${patientId}`),
    ).expect(200);
    expect(res.body.data.full_name).toBe('Patient A');
  });

  // ---------- guardians: global lookup ----------

  it('a guardian is found cross-org by name with full info (global lookup)', async () => {
    const { authB } = await setup();
    const res = await authB(
      request(http()).get('/v1/guardians?search=Khaled'),
    ).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].full_name).toBe('Khaled Guardian');
    expect(res.body.data[0].national_id).toBe('GRD-12345678');
    expect(res.body.data[0].phone_number).toBe('+201111111111');
  });

  it('a guardian is found cross-org by national id (global lookup)', async () => {
    const { authB } = await setup();
    const res = await authB(
      request(http()).get('/v1/guardians?search=GRD-1234'),
    ).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].full_name).toBe('Khaled Guardian');
  });

  it('without a search term, another org does NOT see the guardian (own roster only)', async () => {
    const { authB } = await setup();
    const res = await authB(request(http()).get('/v1/guardians')).expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  it("the guardian's own org sees it in both roster and search", async () => {
    const { authA } = await setup();
    const roster = await authA(request(http()).get('/v1/guardians')).expect(
      200,
    );
    expect(roster.body.data).toHaveLength(1);
    const searched = await authA(
      request(http()).get('/v1/guardians?search=Khaled'),
    ).expect(200);
    expect(searched.body.data[0].full_name).toBe('Khaled Guardian');
  });
});
