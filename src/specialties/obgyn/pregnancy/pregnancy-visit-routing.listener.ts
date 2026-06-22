import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { PregnancyEpisodeRouterService } from './pregnancy-episode-router.service';

/** The slice of the `visit.booked` payload this listener needs. */
interface VisitBookedEvent {
  payload?: {
    visit?: { id?: string; scheduled_at?: Date | string | null };
    journey?: { id?: string };
  };
}

/**
 * Routes a newly-booked pregnancy visit to its trimester episode. Booking
 * (in `core`) attaches the visit to the journey's ACTIVE episode and emits
 * `visit.booked`; this specialty-layer listener reacts and, when the journey is
 * an ACTIVE pregnancy, moves the visit to the trimester matching its GA. Core
 * cannot call pregnancy logic directly (layer boundary), so this is the seam.
 * Best-effort: the visit already committed, so failures are logged, not thrown.
 */
@Injectable()
export class PregnancyVisitRoutingListener {
  private readonly logger = new Logger(PregnancyVisitRoutingListener.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly router: PregnancyEpisodeRouterService,
  ) {}

  @OnEvent('visit.booked')
  async onVisitBooked(event: VisitBookedEvent): Promise<void> {
    try {
      const journeyId = event?.payload?.journey?.id;
      const visitId = event?.payload?.visit?.id;
      if (!journeyId || !visitId) return;

      // Only pregnancy journeys carry an ACTIVE PregnancyJourneyRecord — this is
      // the cheap gate that skips every non-pregnancy booking.
      const record =
        await this.prismaService.db.pregnancyJourneyRecord.findUnique({
          where: { journey_id: journeyId },
        });
      if (!record || record.is_deleted || record.status !== 'ACTIVE') return;

      const scheduledAt = event.payload?.visit?.scheduled_at;
      const asOf = scheduledAt ? new Date(scheduledAt) : new Date();
      const order = this.router.resolveTrimesterOrder(record, asOf);
      if (!order) return; // no dating yet → leave the visit where booking put it

      await this.prismaService.db.$transaction((tx) =>
        this.router.routeVisitToTrimester(tx, journeyId, visitId, order),
      );
    } catch (err) {
      this.logger.error(
        'Failed to route pregnancy visit to its trimester episode',
        err as Error,
      );
    }
  }
}
