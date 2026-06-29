import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Surgical episodes occupy orders 1–3: Pre-op / Surgery / Post-op. */
const MAX_EPISODE_ORDER = 3;

/** Strip a date to UTC midnight so comparisons are day-granular (DST-safe). */
function dayUtc(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Routes a surgical visit to the phase episode (Pre-op / Surgery / Post-op) that
 * matches the visit date relative to the surgery date, and advances the journey's
 * episode pointer. Shared by activation (in-tx, current visit) and the booking
 * listener (subsequent visits). Pure resolution is decoupled from the DB write so
 * it can be unit-tested without Prisma.
 */
@Injectable()
export class SurgicalEpisodeRouterService {
  /**
   * The phase episode `order` for a visit at `asOf` given the planned/actual
   * `surgeryDate`: before the surgery → Pre-op (1); on the day → Surgery (2);
   * after → Post-op (3). Null when no surgery date is set yet (caller leaves the
   * visit in the Pre-op episode where activation put it).
   */
  resolveEpisodeOrder(surgeryDate: Date | null, asOf: Date): number | null {
    if (!surgeryDate) return null;
    const surgery = dayUtc(surgeryDate);
    const visit = dayUtc(asOf);
    if (visit < surgery) return 1;
    if (visit > surgery) return 3;
    return 2;
  }

  /**
   * Re-point `visitId` onto the journey's phase episode with `order`, mark it
   * ACTIVE, and COMPLETE the earlier phase episodes. Graceful no-op if the target
   * episode is missing. Runs in the caller's transaction.
   */
  async routeVisitToEpisode(
    tx: Prisma.TransactionClient,
    journeyId: string,
    visitId: string,
    order: number,
  ): Promise<void> {
    const target = await tx.patientEpisode.findFirst({
      where: { journey_id: journeyId, order, is_deleted: false },
    });
    if (!target || target.order > MAX_EPISODE_ORDER) return;

    await tx.visit.update({
      where: { id: visitId },
      data: { episode_id: target.id },
    });

    if (target.status !== 'ACTIVE') {
      await tx.patientEpisode.update({
        where: { id: target.id },
        data: { status: 'ACTIVE', started_at: target.started_at ?? new Date() },
      });
    }

    // Earlier phases are in the past → close them.
    await tx.patientEpisode.updateMany({
      where: {
        journey_id: journeyId,
        order: { lt: order },
        status: { not: 'COMPLETED' },
        is_deleted: false,
      },
      data: { status: 'COMPLETED', ended_at: new Date() },
    });
  }
}
