export interface AuthContext {
  userId: string;
  profileId: string;
  organizationId: string;
  activeBranchId?: string;
  role: string;
  jobFunction: string | null;
  /**
   * Whether the profile's job function is clinical (`is_clinical = true`).
   * Resolved once in `getProfileContext` so capability predicates
   * (`PermissionCatalog`) can stay pure over `AuthContext` without a DB lookup.
   * Optional for backward-compat with hand-built contexts in tests; the JWT
   * strategy always populates it.
   */
  isClinical?: boolean;
  branchIds: string[];
}
