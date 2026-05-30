/**
 * id-keyed diff for bulk PATCH of repeatable child collections.
 *
 * Given the incoming rows (each carrying an optional `id`) and the set of
 * currently-live row ids, partition the request into three buckets:
 *   - `toUpdate` — rows whose `id` matches a live row (mutate in place)
 *   - `toCreate` — rows with no `id`, or an `id` that isn't live (insert)
 *   - `toDelete` — live ids absent from the request (soft-delete)
 *
 * Callers own the Prisma writes; this helper is pure and transaction-agnostic.
 */
export function splitDiff<T extends { id?: string }>(
  rows: T[],
  liveIds: Set<string>,
): { toUpdate: T[]; toCreate: T[]; toDelete: string[] } {
  const toUpdate: T[] = [];
  const toCreate: T[] = [];
  const keptIds = new Set<string>();
  for (const row of rows) {
    if (row.id && liveIds.has(row.id)) {
      toUpdate.push(row);
      keptIds.add(row.id);
    } else {
      toCreate.push(row);
    }
  }
  const toDelete: string[] = [];
  for (const id of liveIds) {
    if (!keptIds.has(id)) toDelete.push(id);
  }
  return { toUpdate, toCreate, toDelete };
}
