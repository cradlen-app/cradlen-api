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
 * Surgical-history auto-sync between the surgical journey lifecycle and the
 * patient OB/GYN history: activation files the surgery as a PLANNED
 * `gyn_surgeries` row (tagged with the surgical journey id), close finalizes
 * that row's outcome. A cesarean handoff finalizes the pregnancy row (GTPAL)
 * AND files the cesarean surgery row in the same transaction.
 */
describe('OB/GYN — surgical history sync (integration)', () => {
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
  const surgicalUrl = (id: string) => `/v1/visits/${id}/surgical`;
  const surgicalCloseUrl = (id: string) => `/v1/visits/${id}/surgical/close`;
  const pregnancyUrl = (id: string) => `/v1/visits/${id}/pregnancy`;
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

  async function activateSurgical(
    ctx: Ctx,
    body: Record<string, unknown> = {},
  ) {
    await ctx
      .auth(request(http()).post(surgicalUrl(ctx.visitId)))
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
      gyn_surgeries: Array<Record<string, unknown>>;
    };
  }

  // ---------- activation ----------

  it('activation files the surgery as a PLANNED journey-tagged row', async () => {
    const ctx = await seedOpenVisit();
    await activateSurgical(ctx, {
      procedure_code: 'MYOMECTOMY',
      procedure_name: 'Myomectomy',
      planned_date: '2026-09-01',
    });

    const history = await readHistory(ctx);
    expect(history.gyn_surgeries).toHaveLength(1);
    expect(history.gyn_surgeries[0]).toMatchObject({
      outcome: 'PLANNED',
      procedure_code: 'MYOMECTOMY',
      procedure_name: 'Myomectomy',
      surgery_date: '2026-09-01',
    });
    expect(history.gyn_surgeries[0].journey_id).toBeDefined();
    // The surgical sync never touches the GTPAL side.
    expect(history.pregnancies).toHaveLength(0);
    expect(history.obstetric_summary).toBeNull();
  });

  it('adopts a manually pre-entered PLANNED row with the same procedure code (no duplicate)', async () => {
    const ctx = await seedOpenVisit();
    const manualRowId = randomUUID();
    await prisma.patientObgynHistory.create({
      data: {
        patient_id: ctx.patientId,
        gyn_surgeries: [
          {
            id: manualRowId,
            outcome: 'PLANNED',
            procedure_code: 'MYOMECTOMY',
            created_at: new Date().toISOString(),
          },
        ],
      },
    });

    await activateSurgical(ctx, {
      procedure_code: 'MYOMECTOMY',
      procedure_name: 'Myomectomy',
    });

    const history = await readHistory(ctx);
    expect(history.gyn_surgeries).toHaveLength(1);
    expect(history.gyn_surgeries[0]).toMatchObject({ id: manualRowId });
    expect(history.gyn_surgeries[0].journey_id).toBeDefined();
  });

  // ---------- close ----------

  it('close finalizes the row with the outcome, date, and complications', async () => {
    const ctx = await seedOpenVisit();
    await activateSurgical(ctx, {
      procedure_code: 'MYOMECTOMY',
      procedure_name: 'Myomectomy',
      surgery_date: '2026-07-10',
    });

    await ctx
      .auth(request(http()).post(surgicalCloseUrl(ctx.visitId)))
      .send({
        outcome: {
          outcome_type: 'COMPLETED',
          complications: ['Minor bleeding'],
          notes: 'uneventful recovery',
        },
      })
      .expect(201);

    const history = await readHistory(ctx);
    expect(history.gyn_surgeries).toHaveLength(1);
    expect(history.gyn_surgeries[0]).toMatchObject({
      outcome: 'COMPLETED',
      procedure_code: 'MYOMECTOMY',
      surgery_date: '2026-07-10',
      complications: 'Minor bleeding',
      notes: 'uneventful recovery',
    });
  });

  it('an aborted surgery finalizes as ABORTED on the same row', async () => {
    const ctx = await seedOpenVisit();
    await activateSurgical(ctx, { procedure_name: 'Laparoscopy' });

    await ctx
      .auth(request(http()).post(surgicalCloseUrl(ctx.visitId)))
      .send({ outcome: { outcome_type: 'ABORTED', date: '2026-07-12' } })
      .expect(201);

    const history = await readHistory(ctx);
    expect(history.gyn_surgeries).toHaveLength(1);
    expect(history.gyn_surgeries[0]).toMatchObject({
      outcome: 'ABORTED',
      surgery_date: '2026-07-12',
    });
  });

  // ---------- cesarean handoff ----------

  it('cesarean handoff finalizes the pregnancy row AND files the surgery row atomically', async () => {
    const ctx = await seedOpenVisit();
    await ctx
      .auth(request(http()).post(pregnancyUrl(ctx.visitId)))
      .send({ lmp: '2026-01-01' })
      .expect(201);

    await activateSurgical(ctx, {
      procedure_code: 'CESAREAN_SECTION',
      procedure_name: 'Cesarean section',
      pregnancy_outcome: {
        outcome_type: 'LIVE_BIRTH',
        delivery_mode: 'CESAREAN',
      },
    });

    const history = await readHistory(ctx);
    // GTPAL side: the pregnancy row is finalized with the delivery outcome.
    expect(history.pregnancies).toHaveLength(1);
    expect(history.pregnancies[0]).toMatchObject({
      outcome: 'LIVE_BIRTH',
      mode_of_delivery: 'CESAREAN',
    });
    expect(history.obstetric_summary).toMatchObject({ gravida: 1, para: 1 });
    // Surgical side: the cesarean is filed as a PLANNED surgery row tagged
    // with the NEW surgical journey — a different journey than the pregnancy.
    expect(history.gyn_surgeries).toHaveLength(1);
    expect(history.gyn_surgeries[0]).toMatchObject({
      outcome: 'PLANNED',
      procedure_code: 'CESAREAN_SECTION',
    });
    expect(history.gyn_surgeries[0].journey_id).toBeDefined();
    expect(history.gyn_surgeries[0].journey_id).not.toBe(
      history.pregnancies[0].journey_id,
    );
  });

  // ---------- doctor workflow compatibility ----------

  it('the FE echoing rows carrying journey_id back through the examination PATCH is accepted (whitelist)', async () => {
    const ctx = await seedOpenVisit();
    await activateSurgical(ctx, {
      procedure_code: 'MYOMECTOMY',
      procedure_name: 'Myomectomy',
    });
    const history = await readHistory(ctx);

    // The FE echoes bound field values + row identity keys (id, journey_id) —
    // not server-stamped provenance like created_at/created_by_id.
    await ctx
      .auth(request(http()).patch(examUrl(ctx.visitId)))
      .send({
        obgyn_history: {
          gyn_surgeries: history.gyn_surgeries.map((r) => ({
            id: r.id,
            journey_id: r.journey_id,
            procedure_code: r.procedure_code,
            procedure_name: r.procedure_name,
            outcome: r.outcome,
            notes: 'echoed by FE',
          })),
        },
      })
      .expect(200);

    const after = await readHistory(ctx);
    expect(after.gyn_surgeries[0]).toMatchObject({
      journey_id: history.gyn_surgeries[0].journey_id,
      notes: 'echoed by FE',
    });
  });
});
