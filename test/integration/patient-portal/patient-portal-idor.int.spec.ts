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
import { seedOrg } from '../../helpers/financial-helpers';
import { seedVisit } from '../../helpers/visits-helpers';
import { createPatientAccount } from '../../helpers/patient-portal-helpers';

/**
 * Patient-portal cross-account isolation (IDOR). A patient-portal session is
 * scoped to `accessiblePatientIds` (for a patient account: just their own
 * record). Every portal read must filter to that set, and passing another
 * patient's id must 404 — never leak another patient's PHI. This is the most
 * important data-protection invariant in the system and previously had no
 * integration coverage (the suite covered staff auth/clinical/financial only).
 *
 * Patient accounts + the clinical graph are seeded directly via Prisma and the
 * `patient_access` token is minted with the real access secret (the portal
 * strategy verifies the signature + `type`), so these exercise the live guard.
 */
describe('Patient portal — cross-account IDOR (integration)', () => {
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
    // patients/accounts/clinical graph aren't in the shared tenant cleaner;
    // truncating patients CASCADE clears their journeys → episodes → visits →
    // investigations too. Accounts/guardians are cleared explicitly.
    await (
      prisma as unknown as {
        $executeRawUnsafe: (sql: string) => Promise<unknown>;
      }
    ).$executeRawUnsafe(
      'TRUNCATE TABLE "patient_accounts", "patient_guardians", "guardians", "patients" CASCADE',
    );
    mailMock.mockClear();
  });

  /**
   * Two orgs are irrelevant here — both patients are seeded under one clinic so
   * the only thing separating them is the portal account scope, which is exactly
   * what we want to attack.
   */
  async function setup() {
    const clinic = await seedOrg(prisma, 'Clinic', 'owner.portal@example.com');
    const a = await seedVisit(prisma, {
      organizationId: clinic.org.id,
      branchId: clinic.branch.id,
      doctorProfileId: clinic.ownerProfileId,
      status: 'COMPLETED',
      patientName: 'Patient A',
    });
    const b = await seedVisit(prisma, {
      organizationId: clinic.org.id,
      branchId: clinic.branch.id,
      doctorProfileId: clinic.ownerProfileId,
      status: 'COMPLETED',
      patientName: 'Patient B',
    });
    // An investigation on B's visit so we can prove A cannot reach it.
    const bInvestigation = await prisma.visitInvestigation.create({
      data: {
        visit_id: b.visitId,
        ordered_by_id: clinic.ownerProfileId,
        custom_test_name: 'CBC',
        status: 'ORDERED',
      },
    });
    const accA = await createPatientAccount(prisma, a.patientId);
    const accB = await createPatientAccount(prisma, b.patientId);
    return {
      a,
      b,
      bInvestigation,
      accA,
      accB,
      ownerProfileId: clinic.ownerProfileId,
    };
  }

  const auth = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);

  it("rejects listing visits scoped to another patient's id (404)", async () => {
    const { b, accA } = await setup();
    await auth(
      request(app.getHttpServer()).get(
        `/v1/patient-portal/visits?patient_id=${b.patientId}`,
      ),
      accA.token,
    ).expect(404);
  });

  it("rejects listing investigations scoped to another patient's id (404)", async () => {
    const { b, accA } = await setup();
    await auth(
      request(app.getHttpServer()).get(
        `/v1/patient-portal/investigations?patient_id=${b.patientId}`,
      ),
      accA.token,
    ).expect(404);
  });

  it("rejects requesting an upload URL on another patient's investigation (404)", async () => {
    const { bInvestigation, accA } = await setup();
    await auth(
      request(app.getHttpServer()).post(
        `/v1/patient-portal/investigations/${bInvestigation.id}/result-upload-url`,
      ),
      accA.token,
    )
      .send({ content_type: 'application/pdf', size_bytes: 1024 })
      .expect(404);
  });

  it('rejects confirming a result whose key is not prefixed for this investigation (400)', async () => {
    const { a, accA, ownerProfileId } = await setup();
    // A's OWN investigation, so the access gate passes — the only thing that can
    // reject is the server-side key-prefix check. A forged key pointing at a
    // different investigation's prefix (or any arbitrary object) must be refused,
    // so a patient cannot attach someone else's / an arbitrary R2 object to their
    // record.
    const aInvestigation = await prisma.visitInvestigation.create({
      data: {
        visit_id: a.visitId,
        ordered_by_id: ownerProfileId,
        custom_test_name: 'CBC',
        status: 'ORDERED',
      },
    });
    await auth(
      request(app.getHttpServer()).post(
        `/v1/patient-portal/investigations/${aInvestigation.id}/result`,
      ),
      accA.token,
    )
      .send({ key: `investigations/${randomUUID()}/results/evil.pdf` })
      .expect(400);
  });

  it("rejects confirming a result on another patient's investigation (404)", async () => {
    const { bInvestigation, accA } = await setup();
    await auth(
      request(app.getHttpServer()).post(
        `/v1/patient-portal/investigations/${bInvestigation.id}/result`,
      ),
      accA.token,
    )
      .send({
        key: `investigations/${bInvestigation.id}/results/${randomUUID()}.pdf`,
      })
      .expect(404);
  });

  it('a patient sees only their own data (positive control)', async () => {
    const { b, accA, accB } = await setup();
    // A's own visit list resolves (200) and does not contain B's visit.
    const aVisits = await auth(
      request(app.getHttpServer()).get('/v1/patient-portal/visits'),
      accA.token,
    ).expect(200);
    const aVisitIds: string[] = (
      aVisits.body.data as Array<{ id: string }>
    ).map((v) => v.id);
    expect(aVisitIds).not.toContain(b.visitId);

    // B, scoped to their own id, can see B's investigation — proving A's 404 is
    // access control, not mere absence of data.
    const bInv = await auth(
      request(app.getHttpServer()).get(
        `/v1/patient-portal/investigations?patient_id=${b.patientId}`,
      ),
      accB.token,
    ).expect(200);
    expect((bInv.body.data as unknown[]).length).toBeGreaterThan(0);
  });
});
