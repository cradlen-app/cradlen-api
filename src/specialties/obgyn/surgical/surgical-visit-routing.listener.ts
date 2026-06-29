import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { SurgicalEpisodeRouterService } from './surgical-episode-router.service';

/** The slice of the `visit.booked` payload this listener needs. */
interface VisitBookedEvent {
  payload?: {
    visit?: { id?: string; scheduled_at?: Date | string | null };
    journey?: { id?: string };
  };
}

/**
 * Routes a newly-booked surgical visit to its phase episode. Booking (in `core`)
 * attaches the visit to the journey's ACTIVE episode and emits `visit.booked`;
 * this specialty-layer listener reacts and, when the journey is an ACTIVE surgical
 * journey, moves the visit to the phase matching its date vs the surgery date.
 * Best-effort: the visit already committed, so failures are logged, not thrown.
 */
@Injectable()
export class SurgicalVisitRoutingListener {
  private readonly logger = new Logger(SurgicalVisitRoutingListener.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly router: SurgicalEpisodeRouterService,
  ) {}

  @OnEvent('visit.booked')
  async onVisitBooked(event: VisitBookedEvent): Promise<void> {
    try {
      const journeyId = event?.payload?.journey?.id;
      const visitId = event?.payload?.visit?.id;
      if (!journeyId || !visitId) return;

      // Only surgical journeys carry an ACTIVE SurgicalJourneyRecord — the cheap
      // gate that skips every non-surgical booking.
      const record =
        await this.prismaService.db.surgicalJourneyRecord.findUnique({
          where: { journey_id: journeyId },
        });
      if (!record || record.is_deleted || record.status !== 'ACTIVE') return;

      const scheduledAt = event.payload?.visit?.scheduled_at;
      const asOf = scheduledAt ? new Date(scheduledAt) : new Date();
      const order = this.router.resolveEpisodeOrder(record.surgery_date, asOf);
      if (!order) return; // no surgery date yet → leave the visit in place

      await this.prismaService.db.$transaction((tx) =>
        this.router.routeVisitToEpisode(tx, journeyId, visitId, order),
      );
    } catch (err) {
      this.logger.error(
        'Failed to route surgical visit to its phase episode',
        err as Error,
      );
    }
  }
}
