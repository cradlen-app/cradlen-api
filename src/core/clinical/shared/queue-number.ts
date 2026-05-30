import { dayBounds } from '@common/utils/date-range.utils.js';

/**
 * Next per-(doctor, branch, day) queue number: the day's max + 1.
 *
 * The caller supplies the finder closure so each visit type keeps its own
 * Prisma delegate typing and its own day semantics — patient visits bucket on
 * `scheduled_at` and count soft-deleted rows (stable numbers), while medical-rep
 * visits bucket on `checked_in_at` and exclude soft-deleted rows.
 */
export async function nextQueueNumber(
  date: Date,
  findLastInDay: (range: {
    start: Date;
    end: Date;
  }) => Promise<{ queue_number: number | null } | null>,
): Promise<number> {
  const { start, end } = dayBounds(date);
  const last = await findLastInDay({ start, end });
  return (last?.queue_number ?? 0) + 1;
}
