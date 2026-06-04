/**
 * Request-scoped identity for a self-registered patient/guardian, populated by
 * PatientJwtStrategy. Distinct from the staff `AuthContext` — it carries no
 * profile/organization. Exactly one of `patientId` / `guardianId` is set.
 */
export interface PatientAuthContext {
  userId: string;
  patientId?: string;
  guardianId?: string;
  /**
   * Patients this account may act on. For a patient account: just their own
   * record. For a guardian account: every patient linked via a live
   * patient_guardians row.
   */
  accessiblePatientIds: string[];
}
