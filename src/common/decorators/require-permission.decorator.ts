import { SetMetadata } from '@nestjs/common';
import type { CatalogPermissionId } from '@common/authorization/permission-matrix.js';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

/**
 * Declares the capability gate a route requires. The `PermissionGuard` reads
 * this and evaluates it against the request's `AuthContext` via the shared
 * `PermissionCatalog` — the same persona×permission table the frontend uses.
 *
 * This is a *coarse* capability gate only. Branch / ownership row-scoping stays
 * in the service-layer `assert*` checks (defense-in-depth + actual filtering).
 */
export const RequirePermission = (permission: CatalogPermissionId) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);
