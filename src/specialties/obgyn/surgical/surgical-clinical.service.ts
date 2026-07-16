import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { BloodGroupRh, Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { EventBus } from '@infrastructure/messaging/event-bus';
import {
  CLINICAL_EVENTS,
  JourneyClinicalUpdatedEvent,
} from '@core/clinical/events/events.public';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public';
import { TemplateValidator } from '@builder/validator/template.validator';
import { buildRevision } from '../revisions.helper';
import { ObgynHistoryService } from '../patient-history/obgyn-history.service';
import { formatBloodGroupRh } from '../blood-group.util';
import { JourneyClinicalHandler } from '../journeys/journey-clinical.handler';
import { JourneyClinicalRegistry } from '../journeys/journey-clinical.registry';
import { SURGICAL_CARE_PATH_CODE } from './surgical-care-path.guard';
import { SurgicalEpisodeRouterService } from './surgical-episode-router.service';
import { historyRowPatchForSurgicalActivation } from './surgical-history-sync.util';

const SURGICAL_TEMPLATE_CODE = 'obgyn_surgical';

/** Columns the demux coerces from string → Date (`@db.Date`). */
const DATE_COLUMNS = new Set(['planned_date', 'surgery_date']);

// Writable allow-lists per scope. status/created_at/updated_at are lifecycle-
// managed (activation/close) and intentionally excluded.
const JOURNEY_WRITABLE = [
  'procedure_id',
  'procedure_code',
  'procedure_name',
  'indication',
  'planned_date',
  'surgery_date',
  'anesthesia_type',
  'urgency',
] as const;
// Each phase blob is a whole-JSON column written to ITS OWN phase-episode record
// (by episode order), independent of which visit the doctor is on.
const PHASE_BLOBS = [
  { order: 1, column: 'preop_assessment' },
  { order: 2, column: 'operative_summary' },
  { order: 3, column: 'postop_summary' },
] as const;
const VISIT_WRITABLE = [
  'interval_history',
  'wound_assessment',
  'wound_status',
  'plan',
  'recovery_notes',
] as const;

type Body = Record<string, unknown>;
type Data = Record<string, unknown>;

interface VisitJourneyContext {
  episodeId: string;
  journeyId: string;
  patientId: string;
  carePathCode: string | null;
  scheduledAt: Date | null;
}

/**
 * The surgical journey clinical surface — the active-journey tab backing the
 * `OBGYN_SURGICAL` care path. One GET/PATCH pair over a FLAT envelope; the PATCH
 * demuxes each field into its scoped record (journey profile / episode phase
 * summaries / per-visit operative note) inside one transaction, with
 * `*_revisions` shadows, and bumps the single `SurgicalJourneyRecord.version`
 * token on every save. Last-write-wins (no If-Match), like the Examination tab.
 * The GET folds in a read-only `linked_summary` — the source pregnancy journey
 * (cesarean) or the patient's OB/GYN history.
 */
@Injectable()
export class SurgicalClinicalService
  implements JourneyClinicalHandler, OnModuleInit
{
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: PatientAccessService,
    private readonly validator: TemplateValidator,
    private readonly eventBus: EventBus,
    private readonly obgynHistory: ObgynHistoryService,
    private readonly registry: JourneyClinicalRegistry,
    private readonly episodeRouter: SurgicalEpisodeRouterService,
  ) {}

  onModuleInit(): void {
    this.registry.register(SURGICAL_CARE_PATH_CODE, this);
  }

  // ---------------------------------------------------------------------------
  // GET
  // ---------------------------------------------------------------------------

  async get(visitId: string, journeyId: string, user: AuthContext) {
    await this.access.assertVisitInOrg(visitId, user);
    const ctx = await this.resolveContext(visitId, journeyId);

    const journeyRecord =
      await this.prismaService.db.surgicalJourneyRecord.findUnique({
        where: { journey_id: journeyId },
      });
    if (!journeyRecord || journeyRecord.is_deleted) {
      throw new NotFoundException('No surgical profile for this journey');
    }

    // Aggregate ALL three phase-episode records (pre-op / operative / post-op)
    // so every phase pre-fills from any visit — not just the visit's current
    // episode. Each phase blob lives on its own order-keyed episode record.
    const phaseByOrder = await this.loadPhaseEpisodes(journeyId);
    const episodeIds = [...phaseByOrder.values()];
    const [episodeRecords, visitRecord] = await Promise.all([
      episodeIds.length
        ? this.prismaService.db.surgicalEpisodeRecord.findMany({
            where: { episode_id: { in: episodeIds } },
          })
        : Promise.resolve([]),
      this.prismaService.db.visitSurgicalRecord.findUnique({
        where: { visit_id: visitId },
      }),
    ]);
    const recordByEpisode = new Map(
      episodeRecords.map((r) => [r.episode_id, r]),
    );
    const phaseRecord = (order: number) => {
      const episodeId = phaseByOrder.get(order);
      return episodeId ? (recordByEpisode.get(episodeId) ?? null) : null;
    };

    // Which phase does the current visit sit in? (drives FE auto-expand)
    let currentPhaseOrder: number | null = null;
    for (const [order, episodeId] of phaseByOrder) {
      if (episodeId === ctx.episodeId) currentPhaseOrder = order;
    }

    // Raw enum code (e.g. O_POS) so the editable SELECT pre-fills by option
    // code; the linked_summary display formats it (O+).
    const rawBloodGroup = await this.readBloodGroupRaw(ctx.patientId);
    const linkedSummary = await this.buildLinkedSummary(
      journeyRecord.source_pregnancy_journey_id,
      formatBloodGroupRh(rawBloodGroup),
    );

    return this.buildEnvelope(
      journeyRecord,
      phaseRecord(1),
      phaseRecord(2),
      phaseRecord(3),
      visitRecord,
      linkedSummary,
      rawBloodGroup,
      currentPhaseOrder,
    );
  }

  // ---------------------------------------------------------------------------
  // PATCH
  // ---------------------------------------------------------------------------

  async patch(
    visitId: string,
    journeyId: string,
    body: Body,
    user: AuthContext,
  ) {
    await this.access.assertVisitInOrg(visitId, user);
    const ctx = await this.resolveContext(visitId, journeyId);

    const journeyRecord =
      await this.prismaService.db.surgicalJourneyRecord.findUnique({
        where: { journey_id: journeyId },
      });
    if (!journeyRecord || journeyRecord.is_deleted) {
      throw new NotFoundException('No surgical profile for this journey');
    }

    const validation = await this.validator.validatePayload(
      SURGICAL_TEMPLATE_CODE,
      body,
      { sparse: true },
    );
    if (!validation.ok) {
      throw new BadRequestException({
        message: validation.errors.map((e) => `${e.fieldCode} ${e.message}`),
      });
    }

    const profileId = user.profileId;
    const scopes: string[] = [];

    const newVersion = await this.prismaService.db.$transaction(
      async (tx) => {
        // Journey scope — always bump the version token + write one revision,
        // even when only sub-scopes changed (the version is the FE remount key).
        const journeyData = pickWritable(body, JOURNEY_WRITABLE);
        if (Object.keys(journeyData).length > 0) scopes.push('journey');
        await tx.surgicalJourneyRecordRevision.create({
          data: buildRevision(
            journeyRecord,
            Object.keys(journeyData),
            profileId,
          ),
        });
        const updated = await tx.surgicalJourneyRecord.update({
          where: { id: journeyRecord.id },
          data: {
            ...(journeyData as Prisma.SurgicalJourneyRecordUncheckedUpdateInput),
            updated_by_id: profileId,
            version: { increment: 1 },
          },
        });

        // Surgical-history sync: the activation drawer opens the profile with
        // no details, so the Journey-section save is where procedure/date
        // actually become known — refresh the journey-tagged `gyn_surgeries`
        // row from the updated record. ACTIVE-only (a post-close edit must
        // never regress the finalized outcome back to PLANNED); the upsert's
        // idempotency guard skips the write when nothing relevant changed.
        if (
          Object.keys(journeyData).length > 0 &&
          updated.status === 'ACTIVE'
        ) {
          await this.obgynHistory.upsertJourneyGynSurgeryRow(
            tx,
            ctx.patientId,
            journeyId,
            historyRowPatchForSurgicalActivation(updated),
            profileId,
          );
        }

        // When the surgery date changed, re-route the (open) visit onto the
        // phase episode (Pre-op/Surgery/Post-op) matching its visit date and
        // advance the journey's ACTIVE pointer — for the visit timeline only.
        // Phase-scoped writes below target each phase's OWN episode by order, so
        // they no longer depend on where the visit sits. No surgery date → leave
        // the visit in place, matching the visit.booked listener.
        if ('surgery_date' in journeyData) {
          const order = this.episodeRouter.resolveEpisodeOrder(
            updated.surgery_date,
            ctx.scheduledAt ?? new Date(),
          );
          if (order != null) {
            await this.episodeRouter.routeVisitToEpisode(
              tx,
              ctx.journeyId,
              visitId,
              order,
            );
          }
        }

        // Demux each phase blob to its owning phase-episode record (by order).
        const phaseByOrder = await this.loadPhaseEpisodes(journeyId, tx);
        let episodeTouched = false;
        for (const { order, column } of PHASE_BLOBS) {
          if (body[column] === undefined) continue;
          const wrote = await this.upsertEpisodeBlob(
            tx,
            phaseByOrder.get(order),
            column,
            body[column],
            profileId,
          );
          episodeTouched = episodeTouched || wrote;
        }
        if (episodeTouched) scopes.push('episode');

        await this.upsertVisit(tx, visitId, body, profileId, scopes);

        // Patient-level blood group — written through to PatientObgynHistory
        // (single source of truth) in THIS transaction, mirroring the
        // examination tab. The field rides every surgical save, so only write
        // when it actually changed — otherwise every save would churn the
        // history version + revision. `applyPatch` lazy-creates the singleton,
        // so setting it when none exists works. `null` If-Match (last-write-wins).
        if (typeof body.blood_group_rh === 'string' && body.blood_group_rh) {
          const submitted = body.blood_group_rh as BloodGroupRh;
          const currentHistory = await this.obgynHistory.readEnvelope(
            ctx.patientId,
            tx,
          );
          const current =
            (currentHistory as { blood_group_rh?: string | null } | null)
              ?.blood_group_rh ?? null;
          if (current !== submitted) {
            await this.obgynHistory.applyPatch(
              tx,
              ctx.patientId,
              { blood_group_rh: submitted },
              null,
              profileId,
            );
            scopes.push('patient_history');
          }
        }

        return updated.version;
      },
      { timeout: 20_000, maxWait: 10_000 },
    );

    this.eventBus.publish<JourneyClinicalUpdatedEvent>(
      CLINICAL_EVENTS.journey.clinicalUpdated,
      {
        journey_id: journeyId,
        visit_id: visitId,
        care_path_code: ctx.carePathCode ?? SURGICAL_CARE_PATH_CODE,
        scopes,
        updated_by_id: profileId,
        version: newVersion,
      },
    );

    return this.get(visitId, journeyId, user);
  }

  // ---------------------------------------------------------------------------
  // Scoped writers
  // ---------------------------------------------------------------------------

  /**
   * Write ONE phase blob (`preop_assessment` / `operative_summary` /
   * `postop_summary`) to its owning phase-episode record — upserting the record
   * and shadowing the prior row. Returns whether a write happened.
   */
  private async upsertEpisodeBlob(
    tx: Prisma.TransactionClient,
    episodeId: string | undefined,
    column: (typeof PHASE_BLOBS)[number]['column'],
    value: unknown,
    profileId: string,
  ): Promise<boolean> {
    if (!episodeId) return false;
    const data = { [column]: value } as Data;
    const prior = await tx.surgicalEpisodeRecord.findUnique({
      where: { episode_id: episodeId },
    });
    if (prior) {
      await tx.surgicalEpisodeRecordRevision.create({
        data: buildRevision(prior, [column], profileId),
      });
      await tx.surgicalEpisodeRecord.update({
        where: { id: prior.id },
        data: {
          ...(data as Prisma.SurgicalEpisodeRecordUncheckedUpdateInput),
          updated_by_id: profileId,
          version: { increment: 1 },
        },
      });
    } else {
      await tx.surgicalEpisodeRecord.create({
        data: {
          ...(data as Prisma.SurgicalEpisodeRecordUncheckedCreateInput),
          episode_id: episodeId,
          updated_by_id: profileId,
        },
      });
    }
    return true;
  }

  private async upsertVisit(
    tx: Prisma.TransactionClient,
    visitId: string,
    body: Body,
    profileId: string,
    scopes: string[],
  ) {
    const data = pickWritable(body, VISIT_WRITABLE);
    if (Object.keys(data).length === 0) return;
    const prior = await tx.visitSurgicalRecord.findUnique({
      where: { visit_id: visitId },
    });
    if (prior) {
      await tx.visitSurgicalRecordRevision.create({
        data: buildRevision(prior, Object.keys(data), profileId),
      });
      await tx.visitSurgicalRecord.update({
        where: { id: prior.id },
        data: {
          ...(data as Prisma.VisitSurgicalRecordUncheckedUpdateInput),
          updated_by_id: profileId,
          version: { increment: 1 },
        },
      });
    } else {
      await tx.visitSurgicalRecord.create({
        data: {
          ...(data as Prisma.VisitSurgicalRecordUncheckedCreateInput),
          visit_id: visitId,
          updated_by_id: profileId,
        },
      });
    }
    scopes.push('visit');
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async resolveContext(
    visitId: string,
    journeyId: string,
  ): Promise<VisitJourneyContext> {
    const visit = await this.prismaService.db.visit.findFirst({
      where: { id: visitId, is_deleted: false },
      select: {
        scheduled_at: true,
        episode: {
          select: {
            id: true,
            journey: {
              select: {
                id: true,
                patient_id: true,
                care_path: { select: { code: true } },
              },
            },
          },
        },
      },
    });
    const journey = visit?.episode?.journey;
    if (!visit?.episode || !journey) {
      throw new NotFoundException(`Visit ${visitId} has no journey`);
    }
    if (journey.id !== journeyId) {
      throw new NotFoundException('Journey does not match this visit');
    }
    return {
      episodeId: visit.episode.id,
      journeyId: journey.id,
      patientId: journey.patient_id,
      carePathCode: journey.care_path?.code ?? null,
      scheduledAt: visit.scheduled_at,
    };
  }

  /** The journey's phase episodes (Pre-op=1 / Surgery=2 / Post-op=3) → order→id. */
  private async loadPhaseEpisodes(
    journeyId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Map<number, string>> {
    const db = tx ?? this.prismaService.db;
    const episodes = await db.patientEpisode.findMany({
      where: {
        journey_id: journeyId,
        order: { in: [1, 2, 3] },
        is_deleted: false,
      },
      select: { id: true, order: true },
    });
    const byOrder = new Map<number, string>();
    for (const e of episodes) byOrder.set(e.order, e.id);
    return byOrder;
  }

  /** The patient's RAW blood-group enum code from OB/GYN history (or null). */
  private async readBloodGroupRaw(patientId: string): Promise<string | null> {
    const history = await this.obgynHistory.readEnvelope(patientId);
    return (
      (history as { blood_group_rh?: string | null } | null)?.blood_group_rh ??
      null
    );
  }

  /**
   * Read-only cross-journey context for the Summary. A cesarean surgical journey
   * mirrors its source pregnancy journey; any other surgery mirrors the patient's
   * OB/GYN history (blood group). Returns null when neither is available.
   */
  private async buildLinkedSummary(
    sourcePregnancyJourneyId: string | null,
    bloodGroup: string | null,
  ): Promise<Record<string, unknown> | null> {
    if (sourcePregnancyJourneyId) {
      const preg =
        await this.prismaService.db.pregnancyJourneyRecord.findUnique({
          where: { journey_id: sourcePregnancyJourneyId },
          select: {
            journey_id: true,
            risk_level: true,
            lmp: true,
            pregnancy_type: true,
            number_of_fetuses: true,
            delivery_plan: true,
          },
        });
      if (preg) {
        return {
          kind: 'PREGNANCY',
          journey_id: preg.journey_id,
          risk_level: preg.risk_level,
          lmp: formatDate(preg.lmp),
          pregnancy_type: preg.pregnancy_type,
          number_of_fetuses: preg.number_of_fetuses,
          outcome: preg.delivery_plan ?? null,
        };
      }
    }
    return { kind: 'PATIENT_HISTORY', blood_group_rh: bloodGroup };
  }

  private buildEnvelope(
    journey: Prisma.SurgicalJourneyRecordGetPayload<true>,
    preop: Prisma.SurgicalEpisodeRecordGetPayload<true> | null,
    operative: Prisma.SurgicalEpisodeRecordGetPayload<true> | null,
    postop: Prisma.SurgicalEpisodeRecordGetPayload<true> | null,
    visit: Prisma.VisitSurgicalRecordGetPayload<true> | null,
    linkedSummary: Record<string, unknown> | null,
    bloodGroup: string | null,
    currentPhaseOrder: number | null,
  ): Record<string, unknown> {
    return {
      journey_id: journey.journey_id,
      version: journey.version,
      // Which phase the current visit sits in — the FE auto-expands it.
      current_phase_order: currentPhaseOrder,

      // Journey scope. created_at/updated_at are date-only (display).
      status: journey.status,
      created_at: formatDate(journey.created_at),
      updated_at: formatDate(journey.updated_at),
      procedure_id: journey.procedure_id,
      procedure_code: journey.procedure_code,
      procedure_name: journey.procedure_name,
      indication: journey.indication,
      planned_date: formatDate(journey.planned_date),
      surgery_date: formatDate(journey.surgery_date),
      anesthesia_type: journey.anesthesia_type,
      urgency: journey.urgency,

      // Read-only patient context (from OB/GYN history)
      blood_group_rh: bloodGroup,
      // Cross-journey context (read-only)
      linked_summary: linkedSummary,

      // Phase scope — each blob sourced from its own phase-episode record.
      preop_assessment: preop?.preop_assessment ?? null,
      operative_summary: operative?.operative_summary ?? null,
      postop_summary: postop?.postop_summary ?? null,

      // Per-visit post-op follow-up (current visit only)
      interval_history: visit?.interval_history ?? null,
      wound_assessment: visit?.wound_assessment ?? null,
      wound_status: visit?.wound_status ?? null,
      plan: visit?.plan ?? null,
      recovery_notes: visit?.recovery_notes ?? null,
    };
  }
}

/** Format a Date to YYYY-MM-DD (display), or null. */
function formatDate(date: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

/** Coerce a wire value for a column: dates → Date, else as-is. */
function coerce(col: string, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (DATE_COLUMNS.has(col)) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return value;
}

/** Pick + coerce the writable columns present in the body. */
function pickWritable(body: Body, columns: readonly string[]): Data {
  const data: Data = {};
  for (const col of columns) {
    if (body[col] !== undefined) {
      data[col] = coerce(col, body[col]);
    }
  }
  return data;
}
