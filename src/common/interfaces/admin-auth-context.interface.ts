/**
 * Request-scoped identity for a platform admin (cross-tenant operator),
 * populated by AdminJwtStrategy. Distinct from the staff `AuthContext` and the
 * `PatientAuthContext` — it carries no profile, organization, or branch. Every
 * admin is equal (flat tier), so authority is "is an active admin", nothing finer.
 */
export interface AdminAuthContext {
  /** The PlatformAdmin id backing this session (never a staff User / patient id). */
  adminId: string;
  email: string;
}
