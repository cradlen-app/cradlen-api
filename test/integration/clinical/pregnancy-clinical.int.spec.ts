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
import { seedObgynPregnancyTemplate } from '../../../prisma/seeds/obgyn-pregnancy';

/**
 * Pregnancy clinical vertical (journey-centric chart): activation (opens a new
 * pregnancy journey), the active-journey clinical surface (flat envelope,
 * last-write-wins, server-computed GA/EDD + multi-fetus), the care-path switch
 * guard, closing, closed-visit locking, and cross-org isolation. Depends on the seeded
 * OBGYN_PREGNANCY care path, the obgyn_pregnancy template, and the
 * CarePathClinicalSurface row (global-setup runs `prisma db seed`).
 */
describe('OB/GYN — pregnancy clinical surface (integration)', () => {
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
    ).$executeRawUnsafe('TRUNCATE TABLE "patients" CASCADE');
    // cleanDatabase TRUNCATEs organizations CASCADE, which (table-level cascade)
    // also empties care_paths (every row FKs organizations even when null). The
    // OBGYN_PREGNANCY / OBGYN_GENERAL paths + the clinical surface this suite
    // needs are recreated here. The obgyn_pregnancy form template (FKs profiles
    // → also cascade-wiped) is reseeded only where a PATCH validates against it.
    await seedPregnancyPrereqs();
    mailMock.mockClear();
  });

  /** Recreate the OBGYN care paths + clinical-surface row wiped by cleanDatabase. */
  async function seedPregnancyPrereqs() {
    const obgyn = await prisma.specialty.findUniqueOrThrow({
      where: { code: 'OBGYN' },
    });
    // OBGYN_PREGNANCY must resolve to the PREGNANCY journey template, which seeds
    // the First/Second/Third Trimester episodes the trimester router routes into.
    const pregnancyTemplate = await prisma.journeyTemplate.findFirstOrThrow({
      where: { specialty_id: obgyn.id, code: 'PREGNANCY' },
    });
    for (const code of ['OBGYN_PREGNANCY', 'OBGYN_GENERAL']) {
      await prisma.carePath.create({
        data: {
          specialty_id: obgyn.id,
          organization_id: null,
          code,
          name: code,
          journey_template_id: pregnancyTemplate.id,
        },
      });
    }
    await prisma.carePathClinicalSurface.upsert({
      where: {
        specialty_code_care_path_code: {
          specialty_code: 'OBGYN',
          care_path_code: 'OBGYN_PREGNANCY',
        },
      },
      update: {
        template_code: 'obgyn_pregnancy',
        label: 'Pregnancy',
        is_deleted: false,
        deleted_at: null,
      },
      create: {
        specialty_code: 'OBGYN',
        care_path_code: 'OBGYN_PREGNANCY',
        template_code: 'obgyn_pregnancy',
        label: 'Pregnancy',
        order: 0,
      },
    });
  }

  const http = () => app.getHttpServer();
  const activateUrl = (id: string) => `/v1/visits/${id}/pregnancy`;
  const closeUrl = (id: string) => `/v1/visits/${id}/pregnancy/close`;
  const descriptorUrl = (id: string) => `/v1/visits/${id}/journey`;
  const examUrl = (id: string) => `/v1/visits/${id}/examination`;
  const summaryUrl = (patientId: string) =>
    `/v1/patients/${patientId}/active-journey-summary`;
  const clinicalUrl = (visitId: string, journeyId: string) =>
    `/v1/visits/${visitId}/journeys/${journeyId}/clinical`;

  async function accessToken(
    profileId: string,
    orgId: string,
  ): Promise<string> {
    const uid = (
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

  /** Org + OWNER doctor + an IN_PROGRESS visit on the org's single active journey. */
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

  /** Activate a pregnancy and return the resolved journey id. */
  async function activate(
    ctx: Awaited<ReturnType<typeof seedOpenVisit>>,
    body: Record<string, unknown> = {},
  ): Promise<string> {
    await ctx
      .auth(request(http()).post(activateUrl(ctx.visitId)))
      .send(body)
      .expect(201);
    const desc = await ctx
      .auth(request(http()).get(descriptorUrl(ctx.visitId)))
      .expect(200);
    return desc.body.data.journey_id as string;
  }

  // ---------- activation ----------

  it('activation opens a NEW pregnancy journey (≠ booking journey), archives the old one, declares the surface', async () => {
    const ctx = await seedOpenVisit();
    const before = await ctx
      .auth(request(http()).get(descriptorUrl(ctx.visitId)))
      .expect(200);
    const bookingJourneyId = before.body.data.journey_id as string;

    const res = await ctx
      .auth(request(http()).post(activateUrl(ctx.visitId)))
      .send({ lmp: '2026-01-01', risk_level: 'NORMAL' })
      .expect(201);
    expect(res.body.data.status).toBe('ACTIVE');

    const desc = await ctx
      .auth(request(http()).get(descriptorUrl(ctx.visitId)))
      .expect(200);
    // The visit now belongs to a fresh pregnancy journey, not the general one.
    expect(desc.body.data.journey_id).not.toBe(bookingJourneyId);
    expect(desc.body.data.care_path_code).toBe('OBGYN_PREGNANCY');
    expect(desc.body.data.clinical_surface).toEqual({
      template_code: 'obgyn_pregnancy',
      label: 'Pregnancy',
    });
    const oldJourney = await prisma.patientJourney.findUniqueOrThrow({
      where: { id: bookingJourneyId },
    });
    expect(oldJourney.status).toBe('COMPLETED');
  });

  it('routes the visit to its trimester episode by GA (20w → Second Trimester, First completed)', async () => {
    const ctx = await seedOpenVisit();
    // LMP 140 days (= 20w0d) before the visit date → Second Trimester (order 2).
    const v = await prisma.visit.findUniqueOrThrow({
      where: { id: ctx.visitId },
      select: { scheduled_at: true },
    });
    const lmp = new Date(v.scheduled_at.getTime() - 140 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const journeyId = await activate(ctx, { lmp });

    const target = await prisma.patientEpisode.findFirstOrThrow({
      where: { journey_id: journeyId, order: 2 },
    });
    const visit = await prisma.visit.findUniqueOrThrow({
      where: { id: ctx.visitId },
      select: { episode_id: true },
    });
    expect(visit.episode_id).toBe(target.id); // re-pointed to Second Trimester
    expect(target.status).toBe('ACTIVE');
    const firstTri = await prisma.patientEpisode.findFirstOrThrow({
      where: { journey_id: journeyId, order: 1 },
    });
    expect(firstTri.status).toBe('COMPLETED'); // earlier trimester advanced
  });

  it('active-journey-summary returns the pregnancy identifier + risk flag', async () => {
    const ctx = await seedOpenVisit();
    const v = await prisma.visit.findUniqueOrThrow({
      where: { id: ctx.visitId },
      select: { scheduled_at: true },
    });
    const lmp = new Date(v.scheduled_at.getTime() - 140 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await activate(ctx, { lmp, risk_level: 'HIGH' });

    const res = await ctx
      .auth(request(http()).get(summaryUrl(ctx.patientId)))
      .expect(200);
    const body = res.body.data;
    expect(body.journey_exists).toBe(true);
    expect(body.is_active).toBe(true);
    expect(body.care_path_code).toBe('OBGYN_PREGNANCY');
    expect(body.identifier.ga).toBeTruthy();
    expect(body.identifier.edd).toBeTruthy();
    expect(body.flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'High risk', severity: 'high' }),
      ]),
    );
  });

  it('activation is idempotent (second call returns the same profile, 201)', async () => {
    const ctx = await seedOpenVisit();
    await ctx
      .auth(request(http()).post(activateUrl(ctx.visitId)))
      .send({})
      .expect(201);
    await ctx
      .auth(request(http()).post(activateUrl(ctx.visitId)))
      .send({})
      .expect(201);
    const count = await prisma.pregnancyJourneyRecord.count({
      where: { is_deleted: false },
    });
    expect(count).toBe(1);
  });

  // ---------- clinical surface (GET/PATCH) ----------

  it('GET returns a flat envelope with version 1, computed EDD, and history blood group', async () => {
    const ctx = await seedOpenVisit();
    // Blood group is single-sourced from patient OB/GYN history.
    await prisma.patientObgynHistory.create({
      data: { patient_id: ctx.patientId, blood_group_rh: 'O_POS' },
    });
    const journeyId = await activate(ctx, { lmp: '2026-01-01' });

    const res = await ctx
      .auth(request(http()).get(clinicalUrl(ctx.visitId, journeyId)))
      .expect(200);
    expect(res.body.data.journey_id).toBe(journeyId);
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.lmp).toBe('2026-01-01');
    expect(res.body.data.edd_lmp).toBe('2026-10-08'); // LMP + 280 days
    expect(res.body.data.blood_group_rh).toBe('O_POS'); // RAW enum code (editable SELECT pre-fills by code)
    expect(res.body.data.fetuses).toEqual([]);
  });

  it('PATCH demuxes scopes, bumps the version, and round-trips a fetus', async () => {
    // The PATCH validates the payload against the active obgyn_pregnancy
    // template, which cleanDatabase cascade-wiped — reseed it for this test.
    await seedObgynPregnancyTemplate(prisma);
    const ctx = await seedOpenVisit();
    const journeyId = await activate(ctx, { lmp: '2026-01-01' });

    await ctx
      .auth(request(http()).patch(clinicalUrl(ctx.visitId, journeyId)))
      .send({
        risk_level: 'HIGH',
        cervix_length_mm: '30',
        fetuses: [{ fetus_label: 'Fetus A', bpd_mm: '90' }],
      })
      .expect(200);

    const res = await ctx
      .auth(request(http()).get(clinicalUrl(ctx.visitId, journeyId)))
      .expect(200);
    expect(res.body.data.version).toBe(2);
    expect(res.body.data.risk_level).toBe('HIGH');
    expect(res.body.data.cervix_length_mm).toBe('30');
    expect(res.body.data.fetuses).toHaveLength(1);
    expect(res.body.data.fetuses[0].fetus_label).toBe('Fetus A');
    expect(res.body.data.fetuses[0].id).toBeDefined();

    // The journey-record revision shadow captured the prior (v1) snapshot.
    const revisions = await prisma.pregnancyJourneyRecordRevision.count({});
    expect(revisions).toBe(1);
  });

  it('PATCH is last-write-wins (no If-Match) — repeated saves succeed and bump the version', async () => {
    await seedObgynPregnancyTemplate(prisma);
    const ctx = await seedOpenVisit();
    const journeyId = await activate(ctx);
    const url = clinicalUrl(ctx.visitId, journeyId);
    await ctx
      .auth(request(http()).patch(url))
      .send({ risk_level: 'HIGH' })
      .expect(200);
    await ctx
      .auth(request(http()).patch(url))
      .send({ risk_level: 'MODERATE' })
      .expect(200);
    const res = await ctx.auth(request(http()).get(url)).expect(200);
    expect(res.body.data.version).toBe(3);
    expect(res.body.data.risk_level).toBe('MODERATE');
  });

  it('another org cannot read the clinical surface (404, org isolation)', async () => {
    const ctx = await seedOpenVisit();
    const journeyId = await activate(ctx);
    const other = await seedOrg(prisma, 'Other', `other-${Date.now()}@ex.com`);
    const otherAuth = bearer(
      await accessToken(other.ownerProfileId, other.org.id),
    );
    await otherAuth(
      request(http()).get(clinicalUrl(ctx.visitId, journeyId)),
    ).expect(404);
  });

  // ---------- switch guard ----------

  it('switching the care path away from an active pregnancy is blocked (409 PREGNANCY_ACTIVE)', async () => {
    const ctx = await seedOpenVisit();
    await activate(ctx);
    const res = await ctx
      .auth(request(http()).patch(examUrl(ctx.visitId)))
      .send({ case_path: 'OBGYN_GENERAL' })
      .expect(409);
    expect(res.body.error.code).toBe('PREGNANCY_ACTIVE');
  });

  // ---------- close ----------

  it('closing records the outcome, completes the journey, and frees the slot', async () => {
    const ctx = await seedOpenVisit();
    const journeyId = await activate(ctx);

    await ctx
      .auth(request(http()).post(closeUrl(ctx.visitId)))
      .send({
        outcome: {
          outcome_type: 'LIVE_BIRTH',
          delivery_mode: 'CESAREAN',
          notes: 'twins',
        },
      })
      .expect(201);

    const record = await prisma.pregnancyJourneyRecord.findUniqueOrThrow({
      where: { journey_id: journeyId },
    });
    expect(record.status).toBe('CLOSED');
    const journey = await prisma.patientJourney.findUniqueOrThrow({
      where: { id: journeyId },
    });
    expect(journey.status).toBe('COMPLETED');
    expect(journey.ended_at).not.toBeNull();
  });

  // ---------- closed-visit lock ----------

  it('PATCH on a COMPLETED visit is blocked (409 ENCOUNTER_LOCKED)', async () => {
    const ctx = await seedOpenVisit();
    const journeyId = await activate(ctx);
    await prisma.visit.update({
      where: { id: ctx.visitId },
      data: { status: 'COMPLETED' },
    });
    const res = await ctx
      .auth(request(http()).patch(clinicalUrl(ctx.visitId, journeyId)))
      .send({ risk_level: 'HIGH' })
      .expect(409);
    expect(res.body.error.code).toBe('ENCOUNTER_LOCKED');
  });
});
