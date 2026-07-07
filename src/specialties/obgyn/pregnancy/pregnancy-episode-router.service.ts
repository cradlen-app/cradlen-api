import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { gaFromLmp, gaFromUsDating } from './ga.util';
import { trimesterOrderForGa } from './trimester.util';

/** The dating inputs a pregnancy journey carries (LMP and/or US dating). */
export interface PregnancyDating {
  lmp: Date | null;
  us_dating_date: Date | null;
  us_ga_weeks: number | null;
  us_ga_days: number | null;
}

/** Trimester episodes occupy orders 1–3 in the PREGNANCY journey template. */
const MAX_TRIMESTER_ORDER = 3;

/**
 * Routes a pregnancy visit to the trimester episode (First/Second/Third) that
 * matches its gestational age, and advances the journey's episode pointer.
 * Shared by activation (in-tx, current visit) and the booking listener
 * (subsequent visits). Pure resolution is decoupled from the DB write so it can
 * be unit-tested without Prisma.
 */
@Injectable()
export class PregnancyEpisodeRouterService {
  /**
   * The trimester episode `order` (1/2/3) for a pregnancy's dating at `asOf`,
   * or null when there is no usable dating (caller leaves the visit in place).
   * US dating wins when a scan date + measured age are present (clinically it
   * re-dates the pregnancy); otherwise LMP.
   */
  resolveTrimesterOrder(dating: PregnancyDating, asOf: Date): number | null {
    const hasUs =
      dating.us_dating_date != null &&
      (dating.us_ga_weeks != null || dating.us_ga_days != null);
    const ga = hasUs
      ? gaFromUsDating(
          dating.us_dating_date,
          dating.us_ga_weeks,
          dating.us_ga_days,
          asOf,
        )
      : gaFromLmp(dating.lmp, asOf);
    return trimesterOrderForGa(ga);
  }

  /**
   * Re-point `visitId` onto the journey's trimester episode with `order`, mark
   * that episode ACTIVE, and COMPLETE the earlier trimester episodes. Later
   * trimesters stay PENDING; Delivery/Postpartum (order > 3) are untouched.
   * Graceful no-op if the target episode is missing. Runs in the caller's tx.
   * Returns the target episode id (so callers can retarget episode-scoped
   * writes onto the moved-to episode), or null when it was a no-op.
   */
  async routeVisitToTrimester(
    tx: Prisma.TransactionClient,
    journeyId: string,
    visitId: string,
    order: number,
  ): Promise<string | null> {
    const target = await tx.patientEpisode.findFirst({
      where: {
        journey_id: journeyId,
        order,
        is_deleted: false,
      },
    });
    if (!target || target.order > MAX_TRIMESTER_ORDER) return null;

    await tx.visit.update({
      where: { id: visitId },
      data: { episode_id: target.id },
    });

    if (target.status !== 'ACTIVE') {
      await tx.patientEpisode.update({
        where: { id: target.id },
        data: {
          status: 'ACTIVE',
          started_at: target.started_at ?? new Date(),
        },
      });
    }

    // Earlier trimesters are in the past → close them. Bounded to the trimester
    // range so Delivery/Postpartum never get auto-completed.
    await tx.patientEpisode.updateMany({
      where: {
        journey_id: journeyId,
        order: { lt: order },
        status: { not: 'COMPLETED' },
        is_deleted: false,
      },
      data: { status: 'COMPLETED', ended_at: new Date() },
    });

    return target.id;
  }
}
