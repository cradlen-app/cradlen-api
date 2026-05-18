import { Prisma } from '@prisma/client';

export interface RevisionPayload {
  entity_id: string;
  version: number;
  snapshot: Prisma.InputJsonValue;
  changed_fields: Prisma.InputJsonValue;
  revised_by_id: string;
  revision_reason: string | null;
}

/**
 * Build the payload for a `*_revisions` shadow-table insert.
 *
 * The caller has already loaded the live row (`prior`) and is about to update
 * it. We snapshot the prior state INSIDE the same transaction as the update,
 * tagged with the version BEFORE the change. After a successful update,
 * `prior.version` will be one behind the new live version.
 *
 * `changedFields` is the list of column names being touched in this write
 * — useful for auditors scanning for "who touched field X over time"
 * without parsing the snapshot blob.
 */
export function buildRevision(
  prior: { id: string; version: number },
  changedFields: readonly string[],
  revisedById: string,
  reason?: string | null,
): RevisionPayload {
  // Dates / Decimal / etc. serialize cleanly through JSON.stringify when
  // Prisma writes the snapshot column. Casting through `unknown` is safe
  // because the destination is a Json column.
  return {
    entity_id: prior.id,
    version: prior.version,
    snapshot: prior as unknown as Prisma.InputJsonValue,
    changed_fields: changedFields as unknown as Prisma.InputJsonValue,
    revised_by_id: revisedById,
    revision_reason: reason ?? null,
  };
}
