import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { splitDiff } from '@common/utils/id-keyed-diff';
import { EventBus } from '@infrastructure/messaging/event-bus';
import {
  CLINICAL_EVENTS,
  JourneyClinicalUpdatedEvent,
} from '@core/clinical/events/clinical-events';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public';
import { TemplateValidator } from '@builder/validator/template.validator';
import { buildRevision } from '../revisions.helper';
import {
  eddFromLmp,
  eddFromUsDating,
  formatEdd,
  formatGa,
  gaFromLmp,
  gaFromUsDating,
} from './ga.util';

const PREGNANCY_TEMPLATE_CODE = 'obgyn_pregnancy';

/** Columns the demux coerces from string → integer before writing. */
const INT_COLUMNS = new Set([
  'us_ga_weeks',
  'us_ga_days',
  'number_of_fetuses',
  'cervix_effacement_pct',
  'placenta_grade',
  'fetal_heart_rate_bpm',
  'growth_percentile',
]);
/** Columns the demux coerces from string → Date (`@db.Date`). */
const DATE_COLUMNS = new Set(['lmp', 'us_dating_date']);

// Writable allow-lists per scope. Read-only display fields (status, created_at,
// updated_at) are intentionally absent — they are lifecycle-managed by the
// activation/close services, never by this clinical PATCH.
const JOURNEY_WRITABLE = [
  'risk_level',
  'lmp',
  'blood_group_rh',
  'us_dating_date',
  'us_ga_weeks',
  'us_ga_days',
  'pregnancy_type',
  'number_of_fetuses',
  'gender',
] as const;
const EPISODE_WRITABLE = [
  'anomaly_scan',
  'gtt_result',
  'trimester_summary',
] as const;
const VISIT_WRITABLE = [
  'cervix_length_mm',
  'cervix_dilatation_cm',
  'cervix_effacement_pct',
  'cervix_position',
  'membranes',
  'warning_symptoms',
  'fundal_height_cm',
  'fundal_corresponds_ga',
  'amniotic_fluid',
  'placenta_location',
  'placenta_grade',
  'additional_findings',
] as const;
const FETUS_WRITABLE = [
  'fetus_label',
  'gender',
  'fetal_lie',
  'presentation',
  'engagement',
  'fetal_heart_rate_bpm',
  'fetal_rhythm',
  'fetal_movements',
  'bpd_mm',
  'hc_mm',
  'ac_mm',
  'fl_mm',
  'efw_g',
  'growth_percentile',
  'growth_impression',
] as const;

type Body = Record<string, unknown>;
type Data = Record<string, unknown>;

interface VisitJourneyContext {
  episodeId: string;
  journeyId: string;
  carePathCode: string | null;
  scheduledAt: Date | null;
}

/**
 * The pregnancy journey clinical surface — the active-journey tab backing the
 * `OBGYN_PREGNANCY` care path. One GET/PATCH pair over a FLAT envelope; the
 * PATCH demuxes each field into its scoped record (journey profile / episode
 * labs / per-visit maternal surveillance / per-fetus biometrics) inside one
 * transaction, with `*_revisions` shadows, and bumps the single
 * `PregnancyJourneyRecord.version` token (the `If-Match` authority) on every
 * save. Examination stays the single source of truth for complaint/treatment.
 */
@Injectable()
export class PregnancyClinicalService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: PatientAccessService,
    private readonly validator: TemplateValidator,
    private readonly eventBus: EventBus,
  ) {}

  // ---------------------------------------------------------------------------
  // GET
  // ---------------------------------------------------------------------------

  async get(visitId: string, journeyId: string, user: AuthContext) {
    await this.access.assertVisitInOrg(visitId, user);
    const ctx = await this.resolveContext(visitId, journeyId);

    const journeyRecord =
      await this.prismaService.db.pregnancyJourneyRecord.findUnique({
        where: { journey_id: journeyId },
      });
    if (!journeyRecord || journeyRecord.is_deleted) {
      throw new NotFoundException('No pregnancy profile for this journey');
    }

    const [episode, visitRecord, fetuses] = await Promise.all([
      this.prismaService.db.pregnancyEpisodeRecord.findUnique({
        where: { episode_id: ctx.episodeId },
      }),
      this.prismaService.db.visitPregnancyRecord.findUnique({
        where: { visit_id: visitId },
      }),
      this.prismaService.db.visitFetalRecord.findMany({
        where: { visit_id: visitId, is_deleted: false },
        orderBy: { fetus_index: 'asc' },
      }),
    ]);

    const asOf = ctx.scheduledAt ?? new Date();
    return this.buildEnvelope(
      journeyRecord,
      episode,
      visitRecord,
      fetuses,
      asOf,
    );
  }

  // ---------------------------------------------------------------------------
  // PATCH
  // ---------------------------------------------------------------------------

  async patch(
    visitId: string,
    journeyId: string,
    ifMatch: string | undefined,
    body: Body,
    user: AuthContext,
  ) {
    await this.access.assertVisitInOrg(visitId, user);
    const ctx = await this.resolveContext(visitId, journeyId);

    const journeyRecord =
      await this.prismaService.db.pregnancyJourneyRecord.findUnique({
        where: { journey_id: journeyId },
      });
    if (!journeyRecord || journeyRecord.is_deleted) {
      throw new NotFoundException('No pregnancy profile for this journey');
    }

    const expected = this.parseIfMatch(ifMatch);
    if (expected !== journeyRecord.version) {
      throw new PreconditionFailedException({
        code: 'STALE_VERSION',
        message: `Stale version — expected ${journeyRecord.version}, got ${expected}`,
      });
    }

    const validation = await this.validator.validatePayload(
      PREGNANCY_TEMPLATE_CODE,
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
        // even when only sub-scopes changed, so the next If-Match stays valid.
        const journeyData = pickWritable(body, JOURNEY_WRITABLE);
        if (Object.keys(journeyData).length > 0) scopes.push('journey');
        await tx.pregnancyJourneyRecordRevision.create({
          data: buildRevision(
            journeyRecord,
            Object.keys(journeyData),
            profileId,
          ),
        });
        const updated = await tx.pregnancyJourneyRecord.update({
          where: { id: journeyRecord.id },
          data: {
            ...(journeyData as Prisma.PregnancyJourneyRecordUncheckedUpdateInput),
            updated_by_id: profileId,
            version: { increment: 1 },
          },
        });

        await this.upsertEpisode(tx, ctx.episodeId, body, profileId, scopes);
        await this.upsertVisit(tx, visitId, body, profileId, scopes);
        if (body.fetuses !== undefined) {
          await this.diffFetuses(tx, visitId, body.fetuses, profileId);
          scopes.push('fetus');
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
        care_path_code: ctx.carePathCode ?? 'OBGYN_PREGNANCY',
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
    const prior = await tx.pregnancyEpisodeRecord.findUnique({
      where: { episode_id: episodeId },
    });
    if (prior) {
      await tx.pregnancyEpisodeRecordRevision.create({
        data: buildRevision(prior, Object.keys(data), profileId),
      });
      await tx.pregnancyEpisodeRecord.update({
        where: { id: prior.id },
        data: {
          ...(data as Prisma.PregnancyEpisodeRecordUncheckedUpdateInput),
          updated_by_id: profileId,
          version: { increment: 1 },
        },
      });
    } else {
      await tx.pregnancyEpisodeRecord.create({
        data: {
          ...(data as Prisma.PregnancyEpisodeRecordUncheckedCreateInput),
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
    const prior = await tx.visitPregnancyRecord.findUnique({
      where: { visit_id: visitId },
    });
    if (prior) {
      await tx.visitPregnancyRecordRevision.create({
        data: buildRevision(prior, Object.keys(data), profileId),
      });
      await tx.visitPregnancyRecord.update({
        where: { id: prior.id },
        data: {
          ...(data as Prisma.VisitPregnancyRecordUncheckedUpdateInput),
          updated_by_id: profileId,
          version: { increment: 1 },
        },
      });
    } else {
      await tx.visitPregnancyRecord.create({
        data: {
          ...(data as Prisma.VisitPregnancyRecordUncheckedCreateInput),
          visit_id: visitId,
          updated_by_id: profileId,
        },
      });
    }
    scopes.push('visit');
  }

  private async diffFetuses(
    tx: Prisma.TransactionClient,
    visitId: string,
    raw: unknown,
    profileId: string,
  ) {
    const incoming = Array.isArray(raw) ? (raw as Body[]) : [];
    const live = await tx.visitFetalRecord.findMany({
      where: { visit_id: visitId, is_deleted: false },
    });
    const liveById = new Map(live.map((r) => [r.id, r]));
    const liveIds = new Set(liveById.keys());

    // fetus_index tracks display order = position in the submitted array.
    const normalized = incoming.map((row, index) => {
      const data: Data = { fetus_index: index };
      for (const col of FETUS_WRITABLE) {
        if (row[col] !== undefined) data[col] = coerce(col, row[col]);
      }
      return { id: typeof row.id === 'string' ? row.id : undefined, data };
    });

    const { toUpdate, toCreate, toDelete } = splitDiff(normalized, liveIds);

    for (const row of toUpdate) {
      const prior = liveById.get(row.id!)!;
      await tx.visitFetalRecordRevision.create({
        data: buildRevision(prior, Object.keys(row.data), profileId),
      });
      await tx.visitFetalRecord.update({
        where: { id: row.id! },
        data: {
          ...(row.data as Prisma.VisitFetalRecordUncheckedUpdateInput),
          updated_by_id: profileId,
          version: { increment: 1 },
        },
      });
    }
    for (const row of toCreate) {
      await tx.visitFetalRecord.create({
        data: {
          ...(row.data as Prisma.VisitFetalRecordUncheckedCreateInput),
          visit_id: visitId,
          updated_by_id: profileId,
        },
      });
    }
    if (toDelete.length > 0) {
      await tx.visitFetalRecord.updateMany({
        where: { id: { in: toDelete } },
        data: { is_deleted: true, deleted_at: new Date() },
      });
    }
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
              select: { id: true, care_path: { select: { code: true } } },
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
      carePathCode: journey.care_path?.code ?? null,
      scheduledAt: visit.scheduled_at,
    };
  }

  private parseIfMatch(header: string | undefined): number {
    if (!header) {
      throw new BadRequestException('If-Match header is required');
    }
    const match = /^version:(\d+)$/.exec(header.trim());
    if (!match) {
      throw new BadRequestException(
        'If-Match must be of the form "version:<n>"',
      );
    }
    return Number(match[1]);
  }

  private buildEnvelope(
    journey: Prisma.PregnancyJourneyRecordGetPayload<true>,
    episode: Prisma.PregnancyEpisodeRecordGetPayload<true> | null,
    visit: Prisma.VisitPregnancyRecordGetPayload<true> | null,
    fetuses: Prisma.VisitFetalRecordGetPayload<true>[],
    asOf: Date,
  ): Record<string, unknown> {
    return {
      journey_id: journey.journey_id,
      version: journey.version,

      // Journey scope
      status: journey.status,
      created_at: journey.created_at.toISOString(),
      updated_at: journey.updated_at.toISOString(),
      risk_level: journey.risk_level,
      lmp: formatEdd(journey.lmp),
      blood_group_rh: journey.blood_group_rh,
      us_dating_date: formatEdd(journey.us_dating_date),
      us_ga_weeks: journey.us_ga_weeks,
      us_ga_days: journey.us_ga_days,
      pregnancy_type: journey.pregnancy_type,
      number_of_fetuses: journey.number_of_fetuses,
      gender: journey.gender,

      // Computed (read-only)
      ga_lmp: formatGa(gaFromLmp(journey.lmp, asOf)),
      edd_lmp: formatEdd(eddFromLmp(journey.lmp)),
      ga_us: formatGa(
        gaFromUsDating(
          journey.us_dating_date,
          journey.us_ga_weeks,
          journey.us_ga_days,
          asOf,
        ),
      ),
      edd_us: formatEdd(
        eddFromUsDating(
          journey.us_dating_date,
          journey.us_ga_weeks,
          journey.us_ga_days,
        ),
      ),

      // Episode scope (JSON labs)
      anomaly_scan: episode?.anomaly_scan ?? null,
      gtt_result: episode?.gtt_result ?? null,
      trimester_summary: episode?.trimester_summary ?? null,

      // Per-visit scope
      cervix_length_mm: visit?.cervix_length_mm ?? null,
      cervix_dilatation_cm: visit?.cervix_dilatation_cm ?? null,
      cervix_effacement_pct: visit?.cervix_effacement_pct ?? null,
      cervix_position: visit?.cervix_position ?? null,
      membranes: visit?.membranes ?? null,
      warning_symptoms: visit?.warning_symptoms ?? null,
      fundal_height_cm: visit?.fundal_height_cm ?? null,
      fundal_corresponds_ga: visit?.fundal_corresponds_ga ?? null,
      amniotic_fluid: visit?.amniotic_fluid ?? null,
      placenta_location: visit?.placenta_location ?? null,
      placenta_grade: visit?.placenta_grade ?? null,
      additional_findings: visit?.additional_findings ?? null,

      // Per-fetus scope (repeatable)
      fetuses: fetuses.map((f) => ({
        id: f.id,
        fetus_index: f.fetus_index,
        fetus_label: f.fetus_label,
        gender: f.gender,
        fetal_lie: f.fetal_lie,
        presentation: f.presentation,
        engagement: f.engagement,
        fetal_heart_rate_bpm: f.fetal_heart_rate_bpm,
        fetal_rhythm: f.fetal_rhythm,
        fetal_movements: f.fetal_movements,
        bpd_mm: f.bpd_mm,
        hc_mm: f.hc_mm,
        ac_mm: f.ac_mm,
        fl_mm: f.fl_mm,
        efw_g: f.efw_g,
        growth_percentile: f.growth_percentile,
        growth_impression: f.growth_impression,
      })),
    };
  }
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
