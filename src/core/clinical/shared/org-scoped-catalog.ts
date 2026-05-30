import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * Shared rules for org-scoped catalog tables (medications, lab tests) that mix
 * global rows (`organization_id = null`) with per-org rows. The Prisma
 * `findUnique`/`findMany` calls stay in each service (so they keep their own
 * delegate typing); only the scoping predicate and the access rules live here.
 */

type OrgScoped = { organization_id: string | null };

/** Read filter: global rows OR the caller's own org rows. */
export function orgScopedReadFilter(organizationId: string): {
  OR: OrgScoped[];
} {
  return {
    OR: [{ organization_id: null }, { organization_id: organizationId }],
  };
}

/**
 * Guard for a mutate target loaded by id. Rejects a missing/cross-org row with
 * 404 (no existence leak) and a global row with 400. Narrows `row` to non-null
 * for the caller on success.
 */
export function assertOrgMutable<T extends OrgScoped>(
  row: T | null,
  organizationId: string,
  messages: { notFound: string; globalForbidden: string },
): asserts row is T {
  if (!row) throw new NotFoundException(messages.notFound);
  if (row.organization_id === null) {
    throw new BadRequestException(messages.globalForbidden);
  }
  if (row.organization_id !== organizationId) {
    throw new NotFoundException(messages.notFound);
  }
}

/**
 * Guard for referencing a catalog row (global or same org). Throws 400 when the
 * row is missing or belongs to another org.
 */
export function assertOrgReferenceable(
  row: OrgScoped | null,
  organizationId: string,
  message: string,
): void {
  if (
    !row ||
    (row.organization_id !== null && row.organization_id !== organizationId)
  ) {
    throw new BadRequestException(message);
  }
}
