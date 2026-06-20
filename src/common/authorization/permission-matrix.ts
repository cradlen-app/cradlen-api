/**
 * Canonical permission catalog — the single source of truth for *which persona
 * may reach which capability surface*. Pure data (id strings + a persona×id
 * truth table); no predicate logic lives here.
 *
 * The actual predicates live in `PermissionCatalog` (this folder); the
 * `permission-catalog.spec.ts` parity test asserts those predicates reproduce
 * `PERMISSION_MATRIX` for every cell, so they can never silently drift.
 *
 * ⚠️ Keep `PERMISSION_MATRIX` byte-identical to the mirror in
 * `cradlen-web/src/common/kernel-contracts/permissions.ts`. The two repos each
 * prove conformance to the *same* table — that is what keeps the frontend and
 * backend capability gates from drifting apart.
 *
 * Scope: this table governs **capability gates** only (can this persona open
 * this surface at all). Row-level scoping (own visits, branch-only) stays in
 * the imperative `AuthorizationService` / service layer and is intentionally
 * not modelled here.
 */

/** Every permission id, as named constants so usages are typo-checked. */
export const PERMISSIONS = {
  dashboardHome: 'dashboard.home',
  operationsView: 'operations.view',
  clinicalWorkspaceView: 'clinicalWorkspace.view',
  patientDetailView: 'patient.detail.view',
  staffRead: 'staff.read',
  staffManage: 'staff.manage',
  staffEditRoles: 'staff.editRoles',
  staffDelete: 'staff.delete',
  settingsView: 'settings.view',
  settingsManageOrg: 'settings.manageOrg',
  medicineRead: 'medicine.read',
  medicalRepView: 'medicalRep.view',
  financialRead: 'financial.read',
  financialCollectPayment: 'financial.collectPayment',
  financialManageCash: 'financial.manageCash',
  financialRefund: 'financial.refund',
  financialManageCatalog: 'financial.manageCatalog',
  financialManagePricing: 'financial.managePricing',
  financialManageProviderPricing: 'financial.manageProviderPricing',
  financialCaptureCharge: 'financial.captureCharge',
  financialViewReports: 'financial.viewReports',
  financialViewOwnReports: 'financial.viewOwnReports',
  financialViewReportsNav: 'financial.viewReportsNav',
} as const;

/** Union of catalog permission id literals (e.g. `'financial.read'`). */
export type CatalogPermissionId = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * The 7 reference personas. The owner and branch-manager axes are each split by
 * clinical job function: a manager only reaches clinical/patient-detail surfaces
 * when they *also* hold a clinical (doctor) job function. `doctor` is a plain
 * STAFF clinician; clinical personas are specialty-matched to their org.
 */
export const PERSONAS = [
  'ownerDoctor',
  'ownerNonDoctor',
  'branchManagerDoctor',
  'branchManagerNonDoctor',
  'doctor',
  'receptionist',
  'accountant',
] as const;

export type Persona = (typeof PERSONAS)[number];

export type PermissionMatrix = Record<
  CatalogPermissionId,
  Record<Persona, boolean>
>;

const T = true;
const F = false;

/**
 * Persona × permission truth table. Order of columns:
 * ownerDoctor, ownerNonDoctor, branchManagerDoctor, branchManagerNonDoctor,
 * doctor, receptionist, accountant.
 */
export const PERMISSION_MATRIX: PermissionMatrix = {
  // id                         ownDoc ownOnly bmDoc bmOnly doctor recep  acct
  'dashboard.home':            row(T,    T,     T,    T,     T,     F,     F),
  'operations.view':           row(T,    T,     T,    T,     T,     T,     F),
  'clinicalWorkspace.view':    row(T,    F,     T,    F,     T,     T,     F),
  'patient.detail.view':       row(T,    F,     T,    F,     T,     F,     F),
  'staff.read':                row(T,    T,     T,    T,     F,     T,     F),
  'staff.manage':              row(T,    T,     T,    T,     F,     F,     F),
  'staff.editRoles':           row(T,    T,     F,    F,     F,     F,     F),
  'staff.delete':              row(T,    T,     F,    F,     F,     F,     F),
  'settings.view':             row(T,    T,     T,    T,     T,     T,     T),
  'settings.manageOrg':        row(T,    T,     F,    F,     F,     F,     F),
  'medicine.read':             row(T,    T,     T,    T,     T,     F,     F),
  'medicalRep.view':           row(T,    T,     T,    T,     T,     F,     F),
  'financial.read':            row(T,    T,     T,    T,     F,     T,     T),
  'financial.collectPayment':  row(T,    T,     T,    T,     F,     T,     T),
  'financial.manageCash':      row(T,    T,     T,    T,     F,     T,     T),
  'financial.refund':          row(T,    T,     T,    T,     F,     T,     T),
  'financial.manageCatalog':   row(T,    T,     F,    F,     F,     F,     F),
  'financial.managePricing':   row(T,    T,     F,    F,     F,     F,     F),
  'financial.manageProviderPricing': row(T, T,   T,    F,     T,     F,     F),
  'financial.captureCharge':   row(T,    T,     T,    F,     T,     F,     F),
  'financial.viewReports':     row(T,    T,     T,    T,     F,     F,     T),
  'financial.viewOwnReports':  row(T,    F,     T,    F,     T,     F,     F),
  'financial.viewReportsNav':  row(T,    T,     T,    T,     T,     F,     T),
};

function row(
  ownerDoctor: boolean,
  ownerNonDoctor: boolean,
  branchManagerDoctor: boolean,
  branchManagerNonDoctor: boolean,
  doctor: boolean,
  receptionist: boolean,
  accountant: boolean,
): Record<Persona, boolean> {
  return {
    ownerDoctor,
    ownerNonDoctor,
    branchManagerDoctor,
    branchManagerNonDoctor,
    doctor,
    receptionist,
    accountant,
  };
}
