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
    'full_name',
    'national_id',
    'phone_number',
    'email',
    'company_name',
    'scheduled_at',
    'priority',
    'assigned_doctor_id',
    'branch_id',
    'medication_ids',
    'notes',
  ],
  LOOKUP: ['patient_id', 'medical_rep_id'],
  SYSTEM: ['visitor_type'],
  COMPUTED: ['vitals.bmi'],
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
