import { BindingNamespace } from '@prisma/client';

/**
 * Source of truth for legal `(namespace, path)` pairs.
 *
 * Every field in a seeded template runs through `validateBinding(namespace,
 * path)` before upsert, so binding typos never reach the database. A CI
 * contract test (`allowed-paths.contract.spec.ts`) cross-checks this map
 * against the actual `BookVisitDto` / `BookMedicalRepVisitDto` shapes — a DTO
 * rename without an `ALLOWED_PATHS` update fails CI loudly.
 *
 * Why not auto-derive from DTOs? Some legal paths intentionally don't map
 * 1:1 to a single DTO (LOOKUP/SYSTEM/COMPUTED have no DTO column; INTAKE
 * spans `chief_complaint*` + `vitals.*`). The map is the contract.
 */
export const ALLOWED_PATHS = {
  PATIENT: [
    'id',
    'full_name',
    'national_id',
    'date_of_birth',
    'phone_number',
    'address',
    'marital_status',
  ],
  VISIT: [
    'scheduled_at',
    'priority',
    'appointment_type',
    'assigned_doctor_id',
    'branch_id',
    'notes',
    'care_path_code',
  ],
  INTAKE: [
    'chief_complaint',
    'chief_complaint_meta.categories',
    'chief_complaint_meta.onset',
    'chief_complaint_meta.duration',
    'chief_complaint_meta.severity',
    'vitals.systolic_bp',
    'vitals.diastolic_bp',
    'vitals.pulse',
    'vitals.temperature_c',
    'vitals.respiratory_rate',
    'vitals.spo2',
    'vitals.weight_kg',
    'vitals.height_cm',
    // vitals.bmi is COMPUTED — listed under COMPUTED namespace, never sent on wire.
    // vitals.rbs_mmol_l exists on visit_vitals table but no DTO exposes it yet; add here once it does.
  ],
  GUARDIAN: ['full_name', 'national_id', 'phone_number'],
  MEDICAL_REP: [
    'rep_full_name',
    'rep_national_id',
    'rep_phone_number',
    'email',
    'company_name',
    'scheduled_at',
    'priority',
    'assigned_doctor_id',
    'branch_id',
    'medication_ids',
    'notes',
  ],
  LOOKUP: ['patient_id', 'medical_rep_id', 'guardian_id'],
  SYSTEM: ['visitor_type', 'specialty_code'],
  COMPUTED: ['vitals.bmi'],
  // PATIENT_OBGYN_HISTORY targets the unified bulk PATCH at
  // `/patients/:id/obgyn-history`. Singleton JSON columns are reached via
  // their dotted nested path. Repeatable child collections (pregnancies,
  // contraceptives, non_gyn_surgeries, medications, allergies) use the
  // resource slug as the prefix — the array wrapper is conveyed by
  // `FormSection.is_repeatable=true`, not by `[]` in the path.
  PATIENT_OBGYN_HISTORY: [
    'husband_name',
    'gynecological_baseline.age_at_menarche',
    'gynecological_baseline.cycle_regularity',
    'gynecological_baseline.duration',
    'gynecological_baseline.flow',
    'gynecological_baseline.dysmenorrhea',
    'gynecologic_procedures.items',
    'gynecologic_procedures.notes',
    'screening_history.pap_smear',
    'screening_history.pap_smear_date',
    'screening_history.mammography',
    'screening_history.mammography_date',
    'screening_history.vaccines',
    'obstetric_summary.gravida',
    'obstetric_summary.para',
    'obstetric_summary.abortion',
    'obstetric_summary.ectopic',
    'obstetric_summary.stillbirths',
    'medical_chronic_illnesses.items',
    'medical_chronic_illnesses.notes',
    'family_history.gynecologic_cancers',
    'family_history.chronic_illnesses',
    'family_history.genetic_disorders',
    'fertility_history.duration_of_infertility',
    'fertility_history.partner_fertility_status',
    'fertility_history.treatments',
    'fertility_history.menstrual_ovulation_patterns',
    'fertility_history.past_pregnancies_outcomes',
    'pregnancies.birth_date',
    'pregnancies.outcome',
    'pregnancies.mode_of_delivery',
    'pregnancies.gestational_age_weeks',
    'pregnancies.neonatal_outcome',
    'contraceptives.method',
    'contraceptives.duration',
    'contraceptives.complications',
    'non_gyn_surgeries.surgery_name',
    'non_gyn_surgeries.surgery_date',
    'medications.drug_name',
    'medications.medication_id',
    'medications.indication',
    'medications.from_date',
    'allergies.allergy_to',
    'allergies.associated_symptoms',
  ],
} as const satisfies Record<BindingNamespace, readonly string[]>;

export class InvalidBindingError extends Error {
  constructor(namespace: BindingNamespace, path: string) {
    super(
      `Invalid binding: {namespace=${namespace}, path="${path}"} — not in ALLOWED_PATHS. ` +
        `Allowed for ${namespace}: ${ALLOWED_PATHS[namespace].join(', ')}`,
    );
    this.name = 'InvalidBindingError';
  }
}

/**
 * Throws InvalidBindingError if `(namespace, path)` isn't in ALLOWED_PATHS.
 * Null paths are permitted (e.g. for fields that bind by position only).
 */
export function validateBinding(
  namespace: BindingNamespace | null | undefined,
  path: string | null | undefined,
): void {
  if (!namespace || !path) return;
  const legal: readonly string[] = ALLOWED_PATHS[namespace];
  if (!legal.includes(path)) {
    throw new InvalidBindingError(namespace, path);
  }
}
