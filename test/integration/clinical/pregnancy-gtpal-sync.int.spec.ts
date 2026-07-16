import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
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
 * GTPAL auto-sync between the pregnancy journey lifecycle and the patient
 * OB/GYN history: activation files the current pregnancy as an ONGOING
 * `pregnancies` row (tagged with the journey id) so gravida includes it; close
 * (plain or via the surgical cesarean handoff) finalizes that row's outcome so
 * para/abortion/ectopic/stillbirths follow — all derived by the obstetric-
 * summary recompute from the pregnancies collection (single source of truth).
 */
describe('OB/GYN — GTPAL history sync (integration)', () => {
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
    await seedCarePathPrereqs();
    mailMock.mockClear();
  });

  /**
   * Recreate the OBGYN care paths wiped by cleanDatabase (care_paths FK
   * organizations, so the org TRUNCATE cascades into them). Journey templates
   * survive (they FK specialties).
   */
  async function seedCarePathPrereqs() {
    const obgyn = await prisma.specialty.findUniqueOrThrow({
      where: { code: 'OBGYN' },
    });
    const pregnancyTemplate = await prisma.journeyTemplate.findFirstOrThrow({
      where: { specialty_id: obgyn.id, code: 'PREGNANCY' },
    });
    const surgicalTemplate = await prisma.journeyTemplate.findFirstOrThrow({
      where: { specialty_id: obgyn.id, code: 'SURGICAL' },
    });
    for (const [code, templateId] of [
      ['OBGYN_PREGNANCY', pregnancyTemplate.id],
      ['OBGYN_GENERAL', pregnancyTemplate.id],
      ['OBGYN_SURGICAL', surgicalTemplate.id],
    ] as const) {
      await prisma.carePath.create({
        data: {
          specialty_id: obgyn.id,
          organization_id: null,
          code,
          name: code,
          journey_template_id: templateId,
        },
      });
    }
  }

  const http = () => app.getHttpServer();
  const activateUrl = (id: string) => `/v1/visits/${id}/pregnancy`;
  const closeUrl = (id: string) => `/v1/visits/${id}/pregnancy/close`;
  const surgicalUrl = (id: string) => `/v1/visits/${id}/surgical`;
  const examUrl = (id: string) => `/v1/visits/${id}/examination`;
  const historyUrl = (patientId: string) =>
    `/v1/patients/${patientId}/obgyn-history`;

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

  /** Org + OWNER doctor + an IN_PROGRESS visit on the org's active journey. */
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

  type Ctx = Awaited<ReturnType<typeof seedOpenVisit>>;

  async function activate(ctx: Ctx, body: Record<string, unknown> = {}) {
    await ctx
      .auth(request(http()).post(activateUrl(ctx.visitId)))
      .send(body)
      .expect(201);
  }

  async function readHistory(ctx: Ctx) {
    const res = await ctx
      .auth(request(http()).get(historyUrl(ctx.patientId)))
      .expect(200);
    return res.body.data as {
      obstetric_summary: Record<string, number> | null;
      pregnancies: Array<Record<string, unknown>>;
    };
  }

  /** Close-date string N days after the given LMP (controls GA at close). */
  function daysAfter(lmp: string, days: number): string {
    return new Date(new Date(lmp).getTime() + days * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }

  // ---------- activation ----------

  it('activation files the current pregnancy as an ONGOING journey-tagged row (gravida includes it)', async () => {
    const ctx = await seedOpenVisit();
    await activate(ctx, { lmp: '2026-01-01' });

    const history = await readHistory(ctx);
    expect(history.pregnancies).toHaveLength(1);
    expect(history.pregnancies[0]).toMatchObject({ outcome: 'ONGOING' });
    expect(history.pregnancies[0].journey_id).toBeDefined();
    expect(history.obstetric_summary).toEqual({
      gravida: 1,
      para: 0,
      abortion: 0,
      ectopic: 0,
      stillbirths: 0,
    });
  });

  it('adopts a manually pre-entered ONGOING row instead of duplicating it (no double gravida)', async () => {
    const ctx = await seedOpenVisit();
    const manualRowId = randomUUID();
    await prisma.patientObgynHistory.create({
      data: {
        patient_id: ctx.patientId,
        pregnancies: [
          {
            id: manualRowId,
            outcome: 'ONGOING',
            created_at: new Date().toISOString(),
          },
        ],
      },
    });

    await activate(ctx, { lmp: '2026-01-01' });

    const history = await readHistory(ctx);
    expect(history.pregnancies).toHaveLength(1);
    expect(history.pregnancies[0]).toMatchObject({ id: manualRowId });
    expect(history.pregnancies[0].journey_id).toBeDefined();
    expect(history.obstetric_summary?.gravida).toBe(1);
  });

  // ---------- close outcomes ----------

  it('live birth: finalizes the row (outcome, mode, GA from LMP) and bumps para', async () => {
    const ctx = await seedOpenVisit();
    const lmp = '2026-01-01';
    await activate(ctx, { lmp });

    await ctx
      .auth(request(http()).post(closeUrl(ctx.visitId)))
      .send({
        outcome: {
          outcome_type: 'LIVE_BIRTH',
          delivery_mode: 'CESAREAN',
          date: daysAfter(lmp, 273), // 39w0d
        },
      })
      .expect(201);

    const history = await readHistory(ctx);
    expect(history.pregnancies).toHaveLength(1);
    expect(history.pregnancies[0]).toMatchObject({
      outcome: 'LIVE_BIRTH',
      mode_of_delivery: 'CESAREAN',
      gestational_age_weeks: 39,
      birth_date: daysAfter(lmp, 273),
    });
    expect(history.obstetric_summary).toEqual({
      gravida: 1,
      para: 1,
      abortion: 0,
      ectopic: 0,
      stillbirths: 0,
    });
  });

  it('stillbirth at >= 20 weeks counts toward para AND stillbirths', async () => {
    const ctx = await seedOpenVisit();
    const lmp = '2026-01-01';
    await activate(ctx, { lmp });

    await ctx
      .auth(request(http()).post(closeUrl(ctx.visitId)))
      .send({
        outcome: {
          outcome_type: 'STILLBIRTH',
          date: daysAfter(lmp, 154), // 22w0d — viable
        },
      })
      .expect(201);

    const history = await readHistory(ctx);
    expect(history.pregnancies[0]).toMatchObject({
      outcome: 'STILLBIRTH',
      gestational_age_weeks: 22,
    });
    expect(history.obstetric_summary).toEqual({
      gravida: 1,
      para: 1,
      abortion: 0,
      ectopic: 0,
      stillbirths: 1,
    });
  });

  it('stillbirth before 20 weeks counts toward stillbirths but NOT para', async () => {
    const ctx = await seedOpenVisit();
    const lmp = '2026-01-01';
    await activate(ctx, { lmp });

    await ctx
      .auth(request(http()).post(closeUrl(ctx.visitId)))
      .send({
        outcome: {
          outcome_type: 'STILLBIRTH',
          date: daysAfter(lmp, 126), // 18w0d — pre-viable
        },
      })
      .expect(201);

    const history = await readHistory(ctx);
    expect(history.obstetric_summary).toEqual({
      gravida: 1,
      para: 0,
      abortion: 0,
      ectopic: 0,
      stillbirths: 1,
    });
  });

  it('ectopic counts in both abortion and its own ectopic counter', async () => {
    const ctx = await seedOpenVisit();
    await activate(ctx, { lmp: '2026-01-01' });

    await ctx
      .auth(request(http()).post(closeUrl(ctx.visitId)))
      .send({ outcome: { outcome_type: 'ECTOPIC' } })
      .expect(201);

    const history = await readHistory(ctx);
    expect(history.pregnancies[0]).toMatchObject({ outcome: 'ECTOPIC' });
    expect(history.obstetric_summary).toEqual({
      gravida: 1,
      para: 0,
      abortion: 1,
      ectopic: 1,
      stillbirths: 0,
    });
  });

  it('transferred care maps to OTHER and counts gravida only', async () => {
    const ctx = await seedOpenVisit();
    await activate(ctx, { lmp: '2026-01-01' });

    await ctx
      .auth(request(http()).post(closeUrl(ctx.visitId)))
      .send({ outcome: { outcome_type: 'TRANSFERRED' } })
      .expect(201);

    const history = await readHistory(ctx);
    expect(history.pregnancies[0]).toMatchObject({ outcome: 'OTHER' });
    expect(history.obstetric_summary).toEqual({
      gravida: 1,
      para: 0,
      abortion: 0,
      ectopic: 0,
      stillbirths: 0,
    });
  });

  // ---------- cesarean handoff (surgical activation closes the pregnancy) ----------

  it('surgical activation with pregnancy_outcome finalizes the history row atomically', async () => {
    const ctx = await seedOpenVisit();
    await activate(ctx, { lmp: '2026-01-01' });

    await ctx
      .auth(request(http()).post(surgicalUrl(ctx.visitId)))
      .send({
        procedure_name: 'Cesarean section',
        pregnancy_outcome: {
          outcome_type: 'LIVE_BIRTH',
          delivery_mode: 'CESAREAN',
        },
      })
      .expect(201);

    const history = await readHistory(ctx);
    expect(history.pregnancies).toHaveLength(1);
    expect(history.pregnancies[0]).toMatchObject({
      outcome: 'LIVE_BIRTH',
      mode_of_delivery: 'CESAREAN',
    });
    expect(history.obstetric_summary).toEqual({
      gravida: 1,
      para: 1,
      abortion: 0,
      ectopic: 0,
      stillbirths: 0,
    });
  });

  // ---------- doctor workflow compatibility ----------

  it('the FE echoing rows carrying journey_id back through the examination PATCH is accepted (whitelist)', async () => {
    const ctx = await seedOpenVisit();
    await activate(ctx, { lmp: '2026-01-01' });
    const history = await readHistory(ctx);

    // The FE echoes bound field values + row identity keys (id, journey_id) —
    // not server-stamped provenance like created_at/created_by_id.
    await ctx
      .auth(request(http()).patch(examUrl(ctx.visitId)))
      .send({
        obgyn_history: {
          pregnancies: history.pregnancies.map((r) => ({
            id: r.id,
            journey_id: r.journey_id,
            outcome: r.outcome,
            notes: 'echoed by FE',
          })),
        },
      })
      .expect(200);

    const after = await readHistory(ctx);
    expect(after.pregnancies[0]).toMatchObject({
      journey_id: history.pregnancies[0].journey_id,
      notes: 'echoed by FE',
    });
  });

  it('an explicit obstetric_summary still overrides the derived values (manual wins)', async () => {
    const ctx = await seedOpenVisit();
    await activate(ctx, { lmp: '2026-01-01' });
    const history = await readHistory(ctx);

    await ctx
      .auth(request(http()).patch(examUrl(ctx.visitId)))
      .send({
        obgyn_history: {
          pregnancies: history.pregnancies.map((r) => ({
            id: r.id,
            outcome: r.outcome,
          })),
          obstetric_summary: {
            gravida: 6,
            para: 4,
            abortion: 1,
            ectopic: 0,
            stillbirths: 1,
          },
        },
      })
      .expect(200);

    const after = await readHistory(ctx);
    expect(after.obstetric_summary).toEqual({
      gravida: 6,
      para: 4,
      abortion: 1,
      ectopic: 0,
      stillbirths: 1,
    });
  });
});
