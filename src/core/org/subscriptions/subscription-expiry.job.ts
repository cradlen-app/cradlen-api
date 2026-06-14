import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { SubscriptionsService } from './subscriptions.service.js';
import {
  SUBSCRIPTION_EVENTS,
  type SubscriptionExpiredEvent,
} from './subscription.events.js';

/**
 * Flips lapsed subscriptions to EXPIRED:
 * - TRIAL rows past `trial_ends_at`
 * - ACTIVE rows past `ends_at`
 * Idempotent: only matches still-TRIAL/ACTIVE rows with an elapsed date, so a
 * re-run after a crash is a no-op.
 */
@Injectable()
export class SubscriptionExpiryJob {
  private readonly logger = new Logger(SubscriptionExpiryJob.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventBus: EventBus,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleExpiry(): Promise<void> {
    const now = new Date();
    const expired = await this.prismaService.db.subscription.findMany({
      where: {
        is_deleted: false,
        OR: [
          {
            status: SubscriptionStatus.TRIAL,
            trial_ends_at: { not: null, lt: now },
          },
          {
            status: SubscriptionStatus.ACTIVE,
            ends_at: { not: null, lt: now },
          },
        ],
      },
      select: { id: true, organization_id: true },
    });
    if (expired.length === 0) return;

    await this.prismaService.db.subscription.updateMany({
      where: { id: { in: expired.map((s) => s.id) } },
      data: { status: SubscriptionStatus.EXPIRED, ends_at: now },
    });

    for (const row of expired) {
      this.subscriptionsService.bustStatusCache(row.organization_id);
      this.eventBus.publish<SubscriptionExpiredEvent>(
        SUBSCRIPTION_EVENTS.expired,
        {
          subscription_id: row.id,
          organization_id: row.organization_id,
          expired_at: now.toISOString(),
        },
      );
    }

    this.logger.log(`Expired ${expired.length} subscription(s)`);
  }
}
