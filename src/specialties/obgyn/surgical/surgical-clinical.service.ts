import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { EventBus } from '@infrastructure/messaging/event-bus';
import {
  CLINICAL_EVENTS,
  JourneyClinicalUpdatedEvent,
} from '@core/clinical/events/clinical-events';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public';
import { TemplateValidator } from '@builder/validator/template.validator';
import { buildRevision } from '../revisions.helper';
import { ObgynHistoryService } from '../patient-history/obgyn-history.service';
import { formatBloodGroupRh } from '../blood-group.util';
import { JourneyClinicalHandler } from '../journeys/journey-clinical.handler';
import { JourneyClinicalRegistry } from '../journeys/journey-clinical.registry';
import { SURGICAL_CARE_PATH_CODE } from './surgical-care-path.guard';

const SURGICAL_TEMPLATE_CODE = 'obgyn_surgical';

/** Columns the demux coerces from string → integer before writing. */
const INT_COLUMNS = new Set(['estimated_blood_loss_ml', 'duration_minutes']);
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
const EPISODE_WRITABLE = [
  'preop_assessment',
  'operative_summary',
  'postop_summary',
] as const;
const VISIT_WRITABLE = [
  'procedure_performed',
  'findings',
  'estimated_blood_loss_ml',
  'duration_minutes',
  'complications',
  'wound_status',
  'drains',
  'recovery_notes',
  'additional_findings',
] as const;

type Body = Record<string, unknown>;
type Data = Record<string, unknown>;

interface VisitJourneyContext {
  episodeId: string;
  journeyId: string;
  patientId: string;
  carePathCode: string | null;
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

    const [episode, visitRecord] = await Promise.all([
      this.prismaService.db.surgicalEpisodeRecord.findUnique({
        where: { episode_id: ctx.episodeId },
      }),
      this.prismaService.db.visitSurgicalRecord.findUnique({
        where: { visit_id: visitId },
      }),
    ]);

    const linkedSummary = await this.buildLinkedSummary(
      journeyRecord.source_pregnancy_journey_id,
      ctx.patientId,
    );

    return this.buildEnvelope(
      journeyRecord,
      episode,
      visitRecord,
      linkedSummary,
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

        await this.upsertEpisode(tx, ctx.episodeId, body, profileId, scopes);
        await this.upsertVisit(tx, visitId, body, profileId, scopes);

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

  private async upsertEpisode(
    tx: Prisma.TransactionClient,
    episodeId: string,
    body: Body,
    profileId: string,
    scopes: string[],
  ) {
    const data = pickWritable(body, EPISODE_WRITABLE);
    if (Object.keys(data).length === 0) return;
    const prior = await tx.surgicalEpisodeRecord.findUnique({
      where: { episode_id: episodeId },
    });
    if (prior) {
      await tx.surgicalEpisodeRecordRevision.create({
        data: buildRevision(prior, Object.keys(data), profileId),
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
    scopes.push('episode');
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
    };
  }

  /**
   * Read-only cross-journey context for the Summary. A cesarean surgical journey
   * mirrors its source pregnancy journey; any other surgery mirrors the patient's
   * OB/GYN history. Returns null when neither is available.
   */
  private async buildLinkedSummary(
    sourcePregnancyJourneyId: string | null,
    patientId: string,
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
    const history = await this.obgynHistory.readEnvelope(patientId);
    return {
      kind: 'PATIENT_HISTORY',
      blood_group_rh: formatBloodGroupRh(
        (history as { blood_group_rh?: string | null } | null)
          ?.blood_group_rh ?? null,
      ),
    };
  }

  private buildEnvelope(
    journey: Prisma.SurgicalJourneyRecordGetPayload<true>,
    episode: Prisma.SurgicalEpisodeRecordGetPayload<true> | null,
    visit: Prisma.VisitSurgicalRecordGetPayload<true> | null,
    linkedSummary: Record<string, unknown> | null,
  ): Record<string, unknown> {
    return {
      journey_id: journey.journey_id,
      version: journey.version,

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

      // Cross-journey context (read-only)
      linked_summary: linkedSummary,

      // Episode scope (JSON phase summaries)
      preop_assessment: episode?.preop_assessment ?? null,
      operative_summary: episode?.operative_summary ?? null,
      postop_summary: episode?.postop_summary ?? null,

      // Per-visit operative note
      procedure_performed: visit?.procedure_performed ?? null,
      findings: visit?.findings ?? null,
      estimated_blood_loss_ml: visit?.estimated_blood_loss_ml ?? null,
      duration_minutes: visit?.duration_minutes ?? null,
      complications: visit?.complications ?? null,
      wound_status: visit?.wound_status ?? null,
      drains: visit?.drains ?? null,
      recovery_notes: visit?.recovery_notes ?? null,
      additional_findings: visit?.additional_findings ?? null,
    };
  }
}

/** Format a Date to YYYY-MM-DD (display), or null. */
function formatDate(date: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

/** Coerce a wire value for a column: ints → integer, dates → Date, else as-is. */
function coerce(col: string, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (INT_COLUMNS.has(col)) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
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
