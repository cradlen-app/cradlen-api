import { Injectable } from '@nestjs/common';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  PERMISSIONS,
  type CatalogPermissionId,
} from './permission-matrix.js';

/**
 * Capability-gate evaluator. Mirrors the frontend permission predicates
 * (`cradlen-web/src/core/{shell,financial,staff}/permissions.ts`) over the same
 * `AuthContext` fields, so both repos answer "can this persona reach this
 * surface" identically. The `permission-catalog.spec.ts` parity test proves
 * this reproduces `PERMISSION_MATRIX`.
 *
 * This evaluates **capability** only. Row-level scoping (branch / ownership)
 * stays in `AuthorizationService` + the service layer — never model "own rows
 * only" here.
 */
@Injectable()
export class PermissionCatalog {
  check(id: CatalogPermissionId, user: AuthContext): boolean {
    const predicate = PREDICATES[id];
    return predicate ? predicate(user) : false;
  }

  has(id: string): id is CatalogPermissionId {
    return Object.prototype.hasOwnProperty.call(PREDICATES, id);
  }
}

const STAFF_ROLES = new Set(['OWNER', 'BRANCH_MANAGER', 'STAFF']);

const isOwner = (u: AuthContext) => u.role === 'OWNER';
const isBranchManager = (u: AuthContext) => u.role === 'BRANCH_MANAGER';
const isManager = (u: AuthContext) => isOwner(u) || isBranchManager(u);
const isReceptionist = (u: AuthContext) => u.jobFunction === 'RECEPTIONIST';
const isAccountant = (u: AuthContext) => u.jobFunction === 'ACCOUNTANT';
const isClinical = (u: AuthContext) => u.isClinical === true;
const isDoctor = (u: AuthContext) => u.jobFunction === 'DOCTOR';
const hasAnyStaffRole = (u: AuthContext) => STAFF_ROLES.has(u.role);

/** Operational front-desk billing surface (invoices, payments, cash, refunds). */
const canAccessBilling = (u: AuthContext) =>
  isManager(u) || isReceptionist(u) || isAccountant(u);

type Predicate = (user: AuthContext) => boolean;

const PREDICATES: Record<CatalogPermissionId, Predicate> = {
  [PERMISSIONS.dashboardHome]: (u) =>
    hasAnyStaffRole(u) && !isReceptionist(u) && !isAccountant(u),
  [PERMISSIONS.operationsView]: (u) =>
    isManager(u) || isReceptionist(u) || isClinical(u),
  [PERMISSIONS.clinicalWorkspaceView]: (u) => isReceptionist(u) || isClinical(u),
  [PERMISSIONS.patientDetailView]: (u) => isClinical(u),
  [PERMISSIONS.staffRead]: (u) => isManager(u) || isReceptionist(u),
  [PERMISSIONS.staffManage]: (u) => isManager(u),
  [PERMISSIONS.staffEditRoles]: (u) => isOwner(u),
  [PERMISSIONS.staffDelete]: (u) => isOwner(u),
  [PERMISSIONS.settingsView]: (u) => hasAnyStaffRole(u),
  [PERMISSIONS.settingsManageOrg]: (u) => isOwner(u),
  // Specialty-match is a web-only refinement; for the capability gate, any
  // manager or clinician may reach the catalogue.
  [PERMISSIONS.medicineRead]: (u) => isManager(u) || isClinical(u),
  [PERMISSIONS.medicalRepView]: (u) => isManager(u) || isDoctor(u),
  [PERMISSIONS.financialRead]: canAccessBilling,
  [PERMISSIONS.financialCollectPayment]: canAccessBilling,
  [PERMISSIONS.financialManageCash]: canAccessBilling,
  [PERMISSIONS.financialRefund]: canAccessBilling,
  [PERMISSIONS.financialManageCatalog]: (u) => isOwner(u),
  [PERMISSIONS.financialManagePricing]: (u) => isOwner(u),
  [PERMISSIONS.financialManageProviderPricing]: (u) => isOwner(u) || isClinical(u),
  [PERMISSIONS.financialCaptureCharge]: (u) => isDoctor(u) || isOwner(u),
  [PERMISSIONS.financialViewReports]: (u) => isManager(u) || isAccountant(u),
  [PERMISSIONS.financialViewOwnReports]: (u) => isClinical(u),
  [PERMISSIONS.financialViewReportsNav]: (u) =>
    isManager(u) || isAccountant(u) || isClinical(u),
};
