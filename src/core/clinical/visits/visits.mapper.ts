import { Prisma } from '@prisma/client';
import { VisitHistorySummaryDto } from './dto/visit-history-summary.dto.js';
import { JourneyTimelineDto } from './dto/journey-timeline.dto.js';
import { VitalsTrendPointDto } from './dto/vitals-trend-point.dto.js';

/** Prisma `include` for a completed-visit history summary row. */
export const visitHistoryInclude = {
  encounter: { select: { provisional_diagnosis: true } },
  prescription: {
    include: {
      items: {
        where: { is_deleted: false },
        orderBy: { order: 'asc' },
        include: { medication: { select: { name: true } } },
      },
    },
  },
  investigations: {
    where: { is_deleted: false },
    include: { lab_test: { select: { name: true } } },
  },
} satisfies Prisma.VisitInclude;

type VisitHistoryRow = Prisma.VisitGetPayload<{
  include: typeof visitHistoryInclude;
}>;

export function toVisitHistorySummary(
  v: VisitHistoryRow,
): VisitHistorySummaryDto {
  return {
    id: v.id,
    appointment_type: v.appointment_type,
    completed_at: v.completed_at!,
    diagnosis: v.encounter?.provisional_diagnosis ?? null,
    medications: (v.prescription?.items ?? []).map((item) => ({
      name: item.medication?.name ?? item.custom_drug_name ?? '',
      dose: item.dose,
    })),
    investigations: (v.investigations ?? [])
      .map((inv) => inv.lab_test?.name ?? inv.custom_test_name ?? '')
      .filter(Boolean),
  };
}

/**
 * Prisma `include` for a patient journey tree: episodes (ordered) → completed
 * visits (newest first), each visit carrying its history summary relations.
 * `excludeVisitId` drops the currently-open visit from the tree.
 */
export function journeyTimelineInclude(excludeVisitId?: string) {
  return {
    journey_template: { select: { name: true, type: true } },
    episodes: {
      where: { is_deleted: false },
      orderBy: { order: 'asc' },
      include: {
        visits: {
          where: {
            is_deleted: false,
            status: 'COMPLETED' as const,
            ...(excludeVisitId ? { id: { not: excludeVisitId } } : {}),
          },
          orderBy: { completed_at: 'desc' },
          include: visitHistoryInclude,
        },
      },
    },
  } satisfies Prisma.PatientJourneyInclude;
}

type JourneyTimelineRow = Prisma.PatientJourneyGetPayload<{
  include: ReturnType<typeof journeyTimelineInclude>;
}>;

export function toJourneyTimeline(j: JourneyTimelineRow): JourneyTimelineDto {
  return {
    id: j.id,
    name: j.journey_template?.name ?? '',
    type: j.journey_template?.type ?? '',
    status: j.status,
    started_at: j.started_at,
    ended_at: j.ended_at,
    episodes: (j.episodes ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      order: e.order,
      status: e.status,
      started_at: e.started_at,
      ended_at: e.ended_at,
      visits: e.visits.map(toVisitHistorySummary),
    })),
  };
}

/** Prisma `select` for a vitals-trend point row. */
export const vitalsTrendSelect = {
  id: true,
  completed_at: true,
  vitals: {
    where: { is_deleted: false },
    select: {
      systolic_bp: true,
      diastolic_bp: true,
      weight_kg: true,
      bmi: true,
    },
  },
} satisfies Prisma.VisitSelect;

type VitalsTrendRow = Prisma.VisitGetPayload<{
  select: typeof vitalsTrendSelect;
}>;

export function toVitalsTrendPoint(v: VitalsTrendRow): VitalsTrendPointDto {
  return {
    visit_id: v.id,
    completed_at: v.completed_at!,
    systolic_bp: v.vitals?.systolic_bp ?? null,
    diastolic_bp: v.vitals?.diastolic_bp ?? null,
    weight_kg: v.vitals?.weight_kg != null ? Number(v.vitals.weight_kg) : null,
    bmi: v.vitals?.bmi != null ? Number(v.vitals.bmi) : null,
  };
}
