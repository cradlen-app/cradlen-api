/**
 * Maps the `BloodGroupRh` enum code to its human display label, mirroring the
 * `obgyn_patient_history` template options (`prisma/seeds/obgyn-patient-history`)
 * — the same labels the History Summary shows. Negatives use the Unicode minus
 * sign (−, U+2212) to match the template exactly. Keeps blood group consistent
 * across the history, journey, and pregnancy surfaces (all read the one stored
 * `PatientObgynHistory.blood_group_rh`).
 */
const BLOOD_GROUP_LABELS: Record<string, string> = {
  A_POS: 'A+',
  A_NEG: 'A−',
  B_POS: 'B+',
  B_NEG: 'B−',
  AB_POS: 'AB+',
  AB_NEG: 'AB−',
  O_POS: 'O+',
  O_NEG: 'O−',
};

export function formatBloodGroupRh(
  code: string | null | undefined,
): string | null {
  if (code == null) return null;
  return BLOOD_GROUP_LABELS[code] ?? code;
}
