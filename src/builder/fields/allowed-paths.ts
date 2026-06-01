import { BindingNamespace } from '@prisma/client';

/**
 * Source of truth for legal `(namespace, path)` pairs.
 *
 * Every field in a seeded template runs through `validateBinding(namespace,
 * path)` before upsert, so binding typos never reach the database. A CI
 * contract test (`allowed-paths.contract.spec.ts`) cross-checks this map
 * against the actual DTO shapes — `BookVisitDto`, `VisitIntakeFieldsDto`,
 * `BookMedicalRepVisitDto`, `UpsertVitalsDto`, and `ChiefComplaintMetaDto` —
 * so a DTO rename without an `ALLOWED_PATHS` update fails CI loudly.
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
    'follow_up_date',
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
  LOOKUP: ['patient_id', 'medical_rep_id', 'spouse_guardian_id'],
  SYSTEM: ['visitor_type', 'specialty_code'],
  COMPUTED: ['vitals.bmi'],
  // PATIENT_OBGYN_HISTORY targets the unified bulk PATCH at
  // `/patients/:id/obgyn-history`. Singleton JSON columns are reached via
  // their dotted nested path. Repeatable child collections (pregnancies,
  // contraceptives, non_gyn_surgeries, medications, allergies) use the
  // resource slug as the prefix — the array wrapper is conveyed by
  // `FormSection.is_repeatable=true`, not by `[]` in the path.
  PATIENT_OBGYN_HISTORY: [
    'gynecological_baseline.age_at_menarche',
    'gynecological_baseline.cycle_regularity',
    'gynecological_baseline.duration',
    'gynecological_baseline.flow',
    'gynecological_baseline.dysmenorrhea',
    'gynecologic_procedures.items',
    'gynecologic_procedures.notes',
    'gynecologic_conditions.items',
    'gynecologic_conditions.notes',
    'sexual_history.age_first_intercourse',
    'sexual_history.num_partners',
    'sexual_history.partner_gender',
    'sexual_history.currently_active',
    'sexual_history.sti_history',
    'sexual_history.sti_history_other',
    'screening_history.pap_smear',
    'screening_history.pap_smear_date',
    'screening_history.mammography',
    'screening_history.mammography_date',
    'screening_history.vaccines',
    'screening_history.vaccines_other',
    'screening_history.last_colonoscopy',
    'screening_history.last_bone_density',
    'screening_history.last_tetanus',
    'screening_history.last_flu',
    'obstetric_summary.gravida',
    'obstetric_summary.para',
    'obstetric_summary.abortion',
    'obstetric_summary.ectopic',
    'obstetric_summary.stillbirths',
    'medical_chronic_illnesses.items',
    'medical_chronic_illnesses.notes',
    'family_history.gynecologic_cancers',
    'family_history.gynecologic_cancers_other',
    'family_history.chronic_illnesses',
    'family_history.chronic_illnesses_other',
    'family_history.genetic_disorders',
    'fertility_history.duration_of_infertility',
    'fertility_history.partner_fertility_status',
    'fertility_history.treatments',
    'fertility_history.treatments_other',
    'fertility_history.menstrual_ovulation_patterns',
    'fertility_history.past_pregnancies_outcomes',
    'pregnancies.birth_date',
    'pregnancies.outcome',
    'pregnancies.mode_of_delivery',
    'pregnancies.mode_of_delivery_other',
    'pregnancies.gestational_age_weeks',
    'pregnancies.neonatal_outcome',
    'pregnancies.neonatal_outcome_other',
    'pregnancies.baby_weight',
    'pregnancies.baby_sex',
    'pregnancies.complications',
    'family_members.condition',
    'family_members.relative',
    'family_members.age_of_diagnosis',
    'family_members.notes',
    'contraceptives.method',
    'contraceptives.method_other',
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
    // social_history — column existed but paths were missing
    'social_history.smoking',
    'social_history.smoking_status',
    'social_history.smoking_detail',
    'social_history.alcohol',
    'social_history.recreational_drugs',
    'social_history.exercise',
    'social_history.occupation',
    'social_history.employer',
    'social_history.ethnicity',
    // medications — 4 fields present in DTO but absent from template
    'medications.dose',
    'medications.frequency',
    'medications.to_date',
    'medications.is_ongoing',
    // screening_history — HPV/Bethesda clinical fields
    'screening_history.hpv_result',
    'screening_history.bethesda_category',
    // menopause_history — new JSON column
    'menopause_history.menopausal_status',
    'menopause_history.age_at_menopause',
    'menopause_history.hrt_current',
    'menopause_history.hrt_details',
    // blood_group_rh — top-level enum column (no dot)
    'blood_group_rh',
  ],
  // VISIT_ENCOUNTER targets the singleton `visit_encounters` row attached to
  // a visit. Holds main-complaint metadata, free-text complaint, provisional
  // diagnosis, certainty, clinical reasoning, and case path. Examination
  // findings JSON columns live on a separate namespace
  // (`VISIT_OBGYN_ENCOUNTER`) so OB/GYN-specific bindings can't accidentally
  // collide with the generic encounter fields.
  VISIT_ENCOUNTER: [
    'chief_complaint',
    'chief_complaint_meta.categories',
    'chief_complaint_meta.onset',
    'chief_complaint_meta.duration',
    'chief_complaint_meta.severity',
    'provisional_diagnosis',
    'diagnosis_code',
    'diagnosis_certainty',
    'clinical_reasoning',
    'case_path',
  ],
  // VISIT_VITALS targets the singleton `visit_vitals` row. BP is modelled as
  // two siblings (`systolic_bp` + `diastolic_bp`) rather than a composite;
  // BMI is COMPUTED.
  VISIT_VITALS: [
    'systolic_bp',
    'diastolic_bp',
    'pulse',
    'temperature_c',
    'respiratory_rate',
    'spo2',
    'weight_kg',
    'height_cm',
    'rbs_mmol_l',
  ],
  // VISIT_OBGYN_ENCOUNTER targets the OB/GYN exam JSON sections on the
  // `visit_obgyn_encounters` row. Section keys (menstrual_findings,
  // abdominal_findings, pelvic_findings, breast_findings) are the JSON
  // column names; the dotted tail is a nested path inside that JSON.
  VISIT_OBGYN_ENCOUNTER: [
    // Menstrual exam
    'menstrual_findings.lmp',
    'menstrual_findings.cycle',
    'menstrual_findings.pelvic_pain',
    'menstrual_findings.pelvic_pain_type',
    'menstrual_findings.vaginal_discharge',
    'menstrual_findings.discharge_color',
    'menstrual_findings.discharge_odor',
    'menstrual_findings.discharge_amount',
    'menstrual_findings.intermenstrual_bleeding',
    'menstrual_findings.post_coital_bleeding',
    'menstrual_findings.notes',
    // Abdominal exam
    'abdominal_findings.inspection',
    'abdominal_findings.guarding',
    'abdominal_findings.tenderness',
    'abdominal_findings.tenderness_site',
    'abdominal_findings.mass',
    'abdominal_findings.mass_site',
    'abdominal_findings.mass_size',
    'abdominal_findings.mass_tenderness',
    'abdominal_findings.notes',
    // Pelvic — Speculum
    'pelvic_findings.speculum.cervix',
    'pelvic_findings.speculum.vagina',
    'pelvic_findings.speculum.os',
    'pelvic_findings.speculum.notes',
    // Pelvic — Bimanual / Uterus
    'pelvic_findings.bimanual.uterus.size',
    'pelvic_findings.bimanual.uterus.position',
    'pelvic_findings.bimanual.uterus.mobility',
    'pelvic_findings.bimanual.uterus.tenderness',
    'pelvic_findings.bimanual.uterus.surface',
    // Pelvic — Bimanual / Adnexa
    'pelvic_findings.bimanual.adnexa.right',
    'pelvic_findings.bimanual.adnexa.left',
    'pelvic_findings.bimanual.adnexa.cervical_motion_tenderness',
    'pelvic_findings.bimanual.notes',
    // Breast exam
    'breast_findings.inspection.skin',
    'breast_findings.inspection.nipple',
    'breast_findings.inspection.color',
    'breast_findings.inspection.site',
    'breast_findings.palpation.right',
    'breast_findings.palpation.left',
    'breast_findings.notes',
  ],
  // VISIT_INVESTIGATION targets repeatable rows in `visit_investigations`.
  // Row diff is id-keyed (id present → update, absent → create, missing live
  // id → soft-delete). Conveyed by `FormSection.is_repeatable=true`.
  VISIT_INVESTIGATION: [
    'lab_test_id',
    'custom_test_name',
    'test_category',
    'lab_facility',
    'notes',
  ],
  // VISIT_DIAGNOSIS targets repeatable rows in `visit_diagnoses` — the
  // structured ICD-10 diagnosis list. Row diff is id-keyed like
  // VISIT_INVESTIGATION. `code` holds the ICD-10 code (resolved via the
  // diagnosis ENTITY_SEARCH); `description` is the human-readable text.
  VISIT_DIAGNOSIS: ['code', 'description', 'is_primary', 'certainty'],
  // PRESCRIPTION_ITEM targets repeatable rows in `prescription_items` under
  // the visit's `prescriptions` singleton. Row diff semantics identical to
  // VISIT_INVESTIGATION.
  PRESCRIPTION_ITEM: [
    'medication_id',
    'custom_drug_name',
    'dose',
    'frequency',
    'duration',
    'instructions',
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
