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
 * Pregnancy clinical vertical (journey-centric chart): activation, the
 * active-journey clinical surface (flat envelope + If-Match concurrency +
 * server-computed GA/EDD + multi-fetus), the care-path switch guard, closing,
 * closed-visit locking, and cross-org isolation. Depends on the seeded
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
    const journeyTemplate = await prisma.journeyTemplate.findFirstOrThrow({
      where: { specialty_id: obgyn.id },
    });
    for (const code of ['OBGYN_PREGNANCY', 'OBGYN_GENERAL']) {
      await prisma.carePath.create({
        data: {
          specialty_id: obgyn.id,
          organization_id: null,
          code,
          name: code,
          journey_template_id: journeyTemplate.id,
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

  it('activation opens an ACTIVE profile and makes the descriptor declare the surface', async () => {
    const ctx = await seedOpenVisit();
    const res = await ctx
      .auth(request(http()).post(activateUrl(ctx.visitId)))
      .send({ lmp: '2026-01-01', risk_level: 'NORMAL' })
      .expect(201);
    expect(res.body.data.status).toBe('ACTIVE');

    const desc = await ctx
      .auth(request(http()).get(descriptorUrl(ctx.visitId)))
      .expect(200);
    expect(desc.body.data.care_path_code).toBe('OBGYN_PREGNANCY');
    expect(desc.body.data.clinical_surface).toEqual({
      template_code: 'obgyn_pregnancy',
      label: 'Pregnancy',
    });
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

  it('GET returns a flat envelope with version 1 and server-computed EDD', async () => {
    const ctx = await seedOpenVisit();
    const journeyId = await activate(ctx, { lmp: '2026-01-01' });

    const res = await ctx
      .auth(request(http()).get(clinicalUrl(ctx.visitId, journeyId)))
      .expect(200);
    expect(res.body.data.journey_id).toBe(journeyId);
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.lmp).toBe('2026-01-01');
    expect(res.body.data.edd_lmp).toBe('2026-10-08'); // LMP + 280 days
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
      .set('If-Match', 'version:1')
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

  it('PATCH with a stale If-Match is rejected (412)', async () => {
    const ctx = await seedOpenVisit();
    const journeyId = await activate(ctx);
    await ctx
      .auth(request(http()).patch(clinicalUrl(ctx.visitId, journeyId)))
      .set('If-Match', 'version:99')
      .send({ risk_level: 'HIGH' })
      .expect(412);
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
      .send({ delivery_outcome: { mode: 'CESAREAN', notes: 'twins' } })
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
      .set('If-Match', 'version:1')
      .send({ risk_level: 'HIGH' })
      .expect(409);
    expect(res.body.error.code).toBe('ENCOUNTER_LOCKED');
  });
});
