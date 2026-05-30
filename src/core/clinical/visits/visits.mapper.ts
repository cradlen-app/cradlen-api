import { Prisma } from '@prisma/client';
import { VisitHistorySummaryDto } from './dto/visit-history-summary.dto.js';
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
