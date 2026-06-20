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
import { bearer, seedMember } from '../../helpers/auth-helpers';
import { seedOrg } from '../../helpers/financial-helpers';
import { seedVisit } from '../../helpers/visits-helpers';

/**
 * OB/GYN clinical write-path: the examination tab (open-visit edits) and the
 * amendments endpoint (the ONLY legal write path after a visit closes). This is
 * the legal-record-integrity surface — closed-visit locking, amendment authority
 * (assigned doctor or OWNER only), optimistic concurrency (If-Match version), and
 * cross-org isolation. Previously had no integration coverage.
 *
 * Staff access tokens are minted directly (the JWT strategy re-derives the
 * profile context from the DB) instead of via the HTTP login flow — fewer
 * requests, and no global-throttle "bleed" from repeated logins.
 */
describe('OB/GYN — examination + amendments (integration)', () => {
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
    // Clinical graph (patients → journeys → episodes → visits → encounters) is
    // outside the shared tenant cleaner; truncating patients CASCADE clears it.
    await (
      prisma as unknown as {
        $executeRawUnsafe: (sql: string) => Promise<unknown>;
      }
    ).$executeRawUnsafe('TRUNCATE TABLE "patients" CASCADE');
    mailMock.mockClear();
  });

  const http = () => app.getHttpServer();
  const exam = (id: string) => `/v1/visits/${id}/examination`;
  const amend = (id: string) => `/v1/visits/${id}/amendments`;

  /** Mint a staff `access` token the JwtStrategy will accept for this profile. */
  async function accessToken(
    profileId: string,
    orgId: string,
    userId?: string,
  ): Promise<string> {
    const uid =
      userId ??
      (
        await prisma.profile.findUniqueOrThrow({
          where: { id: profileId },
          select: { user_id: true },
        })
      ).user_id;
    return jwt.sign(
      { userId: uid, profileId, organizationId: orgId, type: 'access' },
      { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: '15m' },
    );
  }

  /** Org + OWNER (who is also the assigned doctor) + an IN_PROGRESS OB/GYN visit. */
  async function seedOpenVisit() {
    const org = await seedOrg(
      prisma,
      'OB Clinic',
      `owner-${Date.now()}@ex.com`,
    );
    const auth = bearer(await accessToken(org.ownerProfileId, org.org.id));
    const { visitId, patientId } = await seedVisit(prisma, {
      organizationId: org.org.id,
      branchId: org.branch.id,
      doctorProfileId: org.ownerProfileId,
      status: 'IN_PROGRESS',
    });
    return { org, auth, visitId, patientId };
  }

  /** Open visit, create the encounter via a first PATCH, then close it. */
  async function seedClosedVisitWithEncounter() {
    const ctx = await seedOpenVisit();
    await ctx
      .auth(request(http()).patch(exam(ctx.visitId)))
      .send({ pelvic_findings: { notes: 'Initial exam' } })
      .expect(200);
    await prisma.visit.update({
      where: { id: ctx.visitId },
      data: { status: 'COMPLETED' },
    });
    return ctx;
  }

  // ---------- examination (open visit) ----------

  it('GET examination returns null encounter + version 1 before any write', async () => {
    const { auth, visitId } = await seedOpenVisit();
    const res = await auth(request(http()).get(exam(visitId))).expect(200);
    expect(res.body.data.obgyn_encounter_version).toBe(1);
    expect(res.body.data.pelvic_findings).toBeNull();
  });

  it('PATCH lazily creates the encounter and persists findings', async () => {
    const { auth, visitId } = await seedOpenVisit();
    await auth(request(http()).patch(exam(visitId)))
      .send({ pelvic_findings: { notes: 'Normal' } })
      .expect(200);
    const enc = await prisma.visitObgynEncounter.findUniqueOrThrow({
      where: { visit_id: visitId },
    });
    expect(enc.pelvic_findings).toEqual({ notes: 'Normal' });
  });

  it("another org cannot read a visit's examination (404, org isolation)", async () => {
    const { visitId } = await seedOpenVisit();
    const other = await seedOrg(prisma, 'Other', `other-${Date.now()}@ex.com`);
    const otherAuth = bearer(
      await accessToken(other.ownerProfileId, other.org.id),
    );
    await otherAuth(request(http()).get(exam(visitId))).expect(404);
  });

  // ---------- closed-visit lock ----------

  it('PATCH on a COMPLETED visit is blocked (409 ENCOUNTER_LOCKED)', async () => {
    const { auth, visitId } = await seedClosedVisitWithEncounter();
    const res = await auth(request(http()).patch(exam(visitId)))
      .send({ pelvic_findings: { notes: 'Sneaky edit' } })
      .expect(409);
    expect(res.body.error.code).toBe('ENCOUNTER_LOCKED');
    expect(res.body.error.details.amendment_endpoint).toContain('/amendments');
  });

  // ---------- amendments ----------

  const amendBody = (overrides: Record<string, unknown> = {}) => ({
    target: 'obgyn_encounter',
    section: 'pelvic_findings',
    changes: { notes: 'Corrected after review' },
    reason: 'Correction documented after post-visit review',
    ...overrides,
  });

  it('amendment without If-Match is rejected (412)', async () => {
    const { auth, visitId } = await seedClosedVisitWithEncounter();
    await auth(request(http()).post(amend(visitId)))
      .send(amendBody())
      .expect(412);
  });

  it('amendment with a stale version is rejected (412)', async () => {
    const { auth, visitId } = await seedClosedVisitWithEncounter();
    await auth(request(http()).post(amend(visitId)))
      .set('If-Match', 'version:99')
      .send(amendBody())
      .expect(412);
  });

  it('amendment on an OPEN visit is rejected (409 — amendments are for closed visits)', async () => {
    const { auth, visitId } = await seedOpenVisit();
    // Create the encounter but leave the visit open.
    await auth(request(http()).patch(exam(visitId)))
      .send({ pelvic_findings: { notes: 'Initial' } })
      .expect(200);
    await auth(request(http()).post(amend(visitId)))
      .set('If-Match', 'version:1')
      .send(amendBody())
      .expect(409);
  });

  it('amendment by a non-author, non-OWNER staff is forbidden (403)', async () => {
    const { org, visitId } = await seedClosedVisitWithEncounter();
    const staffEmail = `staff-${Date.now()}@ex.com`;
    const staff = await seedMember(prisma, {
      orgId: org.org.id,
      branchId: org.branch.id,
      email: staffEmail,
      roleCode: 'STAFF',
      assignToBranch: true,
    });
    const staffAuth = bearer(
      await accessToken(staff.profileId, org.org.id, staff.userId),
    );
    await staffAuth(request(http()).post(amend(visitId)))
      .set('If-Match', 'version:1')
      .send(amendBody())
      .expect(403);
  });

  it('amendment with a too-short reason is rejected (400)', async () => {
    const { auth, visitId } = await seedClosedVisitWithEncounter();
    await auth(request(http()).post(amend(visitId)))
      .set('If-Match', 'version:1')
      .send(amendBody({ reason: 'short' }))
      .expect(400);
  });

  it('another org cannot amend the visit (404, org isolation)', async () => {
    const { visitId } = await seedClosedVisitWithEncounter();
    const other = await seedOrg(
      prisma,
      'Other2',
      `other2-${Date.now()}@ex.com`,
    );
    const otherAuth = bearer(
      await accessToken(other.ownerProfileId, other.org.id),
    );
    await otherAuth(request(http()).post(amend(visitId)))
      .set('If-Match', 'version:1')
      .send(amendBody())
      .expect(404);
  });

  it('the assigned doctor can amend a closed visit: version bumps + revision written', async () => {
    const { auth, org, visitId } = await seedClosedVisitWithEncounter();
    const before = await auth(request(http()).get(exam(visitId))).expect(200);
    const v = before.body.data.obgyn_encounter_version as number;

    const res = await auth(request(http()).post(amend(visitId)))
      .set('If-Match', `version:${v}`)
      .send(amendBody())
      .expect(201);

    expect(res.body.data.version_from).toBe(v);
    expect(res.body.data.version_to).toBe(v + 1);
    expect(res.body.data.amended_by_id).toBe(org.ownerProfileId);
    expect(res.body.data.reason).toContain('Correction documented');

    // The prior snapshot is recorded in the revision shadow table.
    const revisions = await prisma.visitObgynEncounterRevision.findMany({});
    expect(revisions.length).toBe(1);
    expect(revisions[0].revision_reason).toContain('Correction documented');

    // The live encounter now carries the amended findings + bumped version.
    const enc = await prisma.visitObgynEncounter.findUniqueOrThrow({
      where: { visit_id: visitId },
    });
    expect(enc.version).toBe(v + 1);
    expect(enc.pelvic_findings).toEqual({ notes: 'Corrected after review' });
  });
});
