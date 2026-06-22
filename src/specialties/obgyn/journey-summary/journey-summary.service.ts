import { Injectable } from '@nestjs/common';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public';
import { ObgynHistoryService } from '../patient-history/obgyn-history.service';
import {
  eddFromLmp,
  eddFromUsDating,
  formatEdd,
  formatGa,
  gaFromLmp,
  gaFromUsDating,
  type GestationalAge,
} from '../pregnancy/ga.util';
import {
  ActiveJourneySummaryDto,
  JourneyIdentifierDto,
  JourneySummaryFlagDto,
} from './dto/active-journey-summary.dto';

const PREGNANCY_CARE_PATH = 'OBGYN_PREGNANCY';
const MULTIPLE_TYPES = new Set([
  'TWINS',
  'TRIPLETS',
  'HIGHER_ORDER',
  'MULTIPLE',
]);

const EMPTY: ActiveJourneySummaryDto = {
  journey_exists: false,
  journey_id: null,
  care_path_code: null,
  care_path_label: null,
  status: null,
  is_active: false,
  started_at: null,
  ended_at: null,
  current_episode: null,
  encounter: null,
  identifier: null,
  outcome: null,
  flags: [],
  narrative: '',
};

interface PregnancyRecordShape {
  status: string | null;
  risk_level: string | null;
  lmp: Date | null;
  us_dating_date: Date | null;
  us_ga_weeks: number | null;
  us_ga_days: number | null;
  pregnancy_type: string | null;
  number_of_fetuses: number | null;
  delivery_plan: unknown;
}

/**
 * Curates a read-only summary of the patient's CURRENT journey (the single
 * ACTIVE one, else the most-recent COMPLETED). Mirrors the OB/GYN history
 * summary: a generic header + an `encounter` gist for every journey, plus a
 * pregnancy `identifier`/outcome/flags when the care path declares the surface.
 */
@Injectable()
export class JourneySummaryService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: PatientAccessService,
    private readonly obgynHistory: ObgynHistoryService,
  ) {}

  async getActiveJourneySummary(
    patientId: string,
    user: AuthContext,
  ): Promise<ActiveJourneySummaryDto> {
    await this.access.assertPatientAccessible(patientId, user);
    const db = this.prismaService.db;

    // The single ACTIVE journey; else the most-recently ended COMPLETED one.
    const journey =
      (await db.patientJourney.findFirst({
        where: { patient_id: patientId, is_deleted: false, status: 'ACTIVE' },
        orderBy: { started_at: 'desc' },
        include: journeyInclude,
      })) ??
      (await db.patientJourney.findFirst({
        where: {
          patient_id: patientId,
          is_deleted: false,
          status: 'COMPLETED',
        },
        orderBy: [{ ended_at: 'desc' }, { started_at: 'desc' }],
        include: journeyInclude,
      }));

    if (!journey) return EMPTY;

    const isActive = journey.status === 'ACTIVE';
    const asOf = isActive ? new Date() : (journey.ended_at ?? new Date());
    const carePathCode = journey.care_path?.code ?? null;

    const currentEpisode =
      journey.episodes.find((e) => e.status === 'ACTIVE') ??
      journey.episodes[journey.episodes.length - 1] ??
      null;

    // Latest visit's encounter gist (the primary content for non-surface paths).
    const latestVisit = await db.visit.findFirst({
      where: { is_deleted: false, episode: { journey_id: journey.id } },
      orderBy: { scheduled_at: 'desc' },
      select: {
        encounter: {
          select: { chief_complaint: true, provisional_diagnosis: true },
        },
      },
    });
    const chiefComplaint = latestVisit?.encounter?.chief_complaint ?? null;
    const provisionalDiagnosis =
      latestVisit?.encounter?.provisional_diagnosis ?? null;
    const encounter =
      chiefComplaint || provisionalDiagnosis
        ? {
            chief_complaint: chiefComplaint,
            provisional_diagnosis: provisionalDiagnosis,
          }
        : null;

    const base: ActiveJourneySummaryDto = {
      ...EMPTY,
      journey_exists: true,
      journey_id: journey.id,
      care_path_code: carePathCode,
      care_path_label: journey.care_path?.name ?? null,
      status: journey.status,
      is_active: isActive,
      started_at: journey.started_at?.toISOString() ?? null,
      ended_at: journey.ended_at?.toISOString() ?? null,
      current_episode: currentEpisode
        ? {
            name: currentEpisode.name,
            order: currentEpisode.order,
            status: currentEpisode.status,
          }
        : null,
      encounter,
    };

    const record = journey.pregnancy_record as PregnancyRecordShape | null;
    if (carePathCode !== PREGNANCY_CARE_PATH || !record) {
      return { ...base, narrative: buildGenericNarrative(base, encounter) };
    }

    return this.buildPregnancySummary(base, record, patientId, asOf);
  }

  private async buildPregnancySummary(
    base: ActiveJourneySummaryDto,
    record: PregnancyRecordShape,
    patientId: string,
    asOf: Date,
  ): Promise<ActiveJourneySummaryDto> {
    const history = await this.obgynHistory.readEnvelope(patientId);
    const bloodGroup =
      (history as { blood_group_rh?: string | null } | null)?.blood_group_rh ??
      null;

    const hasUs =
      record.us_dating_date != null &&
      (record.us_ga_weeks != null || record.us_ga_days != null);
    const ga: GestationalAge | null = hasUs
      ? gaFromUsDating(
          record.us_dating_date,
          record.us_ga_weeks,
          record.us_ga_days,
          asOf,
        )
      : gaFromLmp(record.lmp, asOf);
    const edd = hasUs
      ? eddFromUsDating(
          record.us_dating_date,
          record.us_ga_weeks,
          record.us_ga_days,
        )
      : eddFromLmp(record.lmp);

    const identifier: JourneyIdentifierDto = {
      ga: formatGa(ga),
      ga_source: ga ? (hasUs ? 'US' : 'LMP') : null,
      edd: formatEdd(edd),
      lmp: record.lmp ? record.lmp.toISOString().slice(0, 10) : null,
      risk_level: record.risk_level,
      pregnancy_type: record.pregnancy_type,
      number_of_fetuses: record.number_of_fetuses,
      blood_group_rh: bloodGroup,
    };

    const outcome =
      !base.is_active && record.delivery_plan
        ? (record.delivery_plan as Record<string, unknown>)
        : null;

    const flags = await this.buildPregnancyFlags(
      base.journey_id!,
      record,
      ga,
      outcome,
    );

    return {
      ...base,
      identifier,
      outcome,
      flags,
      narrative: buildPregnancyNarrative(base, identifier),
    };
  }

  private async buildPregnancyFlags(
    journeyId: string,
    record: PregnancyRecordShape,
    ga: GestationalAge | null,
    outcome: Record<string, unknown> | null,
  ): Promise<JourneySummaryFlagDto[]> {
    const flags: JourneySummaryFlagDto[] = [];
    const risk = (record.risk_level ?? '').toUpperCase();
    if (risk === 'HIGH') flags.push({ label: 'High risk', severity: 'high' });
    else if (risk === 'MODERATE')
      flags.push({ label: 'Moderate risk', severity: 'medium' });

    const multiple =
      (record.number_of_fetuses ?? 0) > 1 ||
      MULTIPLE_TYPES.has((record.pregnancy_type ?? '').toUpperCase());
    if (multiple)
      flags.push({ label: 'Multiple gestation', severity: 'medium' });

    if (ga && ga.weeks >= 42)
      flags.push({ label: 'Post-term', severity: 'high' });
    else if (ga && ga.weeks >= 41)
      flags.push({ label: 'Late-term', severity: 'medium' });

    // Episode labs (GTT / anomaly scan) across the journey's episodes.
    const episodeRecords =
      await this.prismaService.db.pregnancyEpisodeRecord.findMany({
        where: { is_deleted: false, episode: { journey_id: journeyId } },
        select: { gtt_result: true, anomaly_scan: true },
      });
    for (const er of episodeRecords) {
      const gtt = er.gtt_result as { interpretation?: string } | null;
      if ((gtt?.interpretation ?? '').toUpperCase().includes('GDM'))
        flags.push({ label: 'GDM', severity: 'high' });
      const anomaly = er.anomaly_scan as { result?: string } | null;
      if ((anomaly?.result ?? '').toUpperCase() === 'ABNORMAL')
        flags.push({ label: 'Abnormal anomaly scan', severity: 'high' });
    }

    if (outcome) {
      const rawType = outcome.outcome_type;
      const type = typeof rawType === 'string' ? rawType.toUpperCase() : '';
      if (type === 'LIVE_BIRTH')
        flags.push({ label: 'Live birth', severity: 'positive' });
      else if (type)
        flags.push({
          label: humanize(type),
          severity: 'high',
        });
    }

    return flags;
  }
}

const journeyInclude = {
  care_path: { select: { code: true, name: true } },
  episodes: {
    where: { is_deleted: false },
    orderBy: { order: 'asc' as const },
    select: { id: true, name: true, order: true, status: true },
  },
  pregnancy_record: true,
} as const;

function humanize(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildGenericNarrative(
  base: ActiveJourneySummaryDto,
  encounter: ActiveJourneySummaryDto['encounter'],
): string {
  const parts: string[] = [];
  parts.push(
    `${base.is_active ? 'Active' : 'Past'} ${base.care_path_label ?? 'journey'}`,
  );
  if (base.current_episode) parts.push(base.current_episode.name);
  if (encounter?.chief_complaint) parts.push(encounter.chief_complaint);
  if (encounter?.provisional_diagnosis)
    parts.push(`provisional: ${encounter.provisional_diagnosis}`);
  return parts.join(' · ');
}

function buildPregnancyNarrative(
  base: ActiveJourneySummaryDto,
  identifier: JourneyIdentifierDto,
): string {
  const parts: string[] = [];
  parts.push(`${base.is_active ? 'Active' : 'Past'} pregnancy`);
  if (identifier.ga)
    parts.push(
      `${identifier.ga}${identifier.ga_source ? ` (${identifier.ga_source})` : ''}`,
    );
  if (identifier.edd) parts.push(`EDD ${identifier.edd}`);
  if (base.current_episode) parts.push(base.current_episode.name);
  if (identifier.risk_level && identifier.risk_level.toUpperCase() !== 'NORMAL')
    parts.push(`${identifier.risk_level.toLowerCase()} risk`);
  return parts.join(' · ');
}
