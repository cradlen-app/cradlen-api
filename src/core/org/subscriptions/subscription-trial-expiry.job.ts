import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';

/**
 * Flips TRIAL subscriptions to EXPIRED once `trial_ends_at` is in the past.
 * Idempotent: only matches still-TRIAL rows with an elapsed trial_ends_at,
 * so a re-run after a crash is a no-op.
 */
@Injectable()
export class SubscriptionTrialExpiryJob {
  private readonly logger = new Logger(SubscriptionTrialExpiryJob.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleExpiry(): Promise<void> {
    const now = new Date();
    const expired = await this.prismaService.db.subscription.findMany({
      where: {
        status: SubscriptionStatus.TRIAL,
        is_deleted: false,
        trial_ends_at: { not: null, lt: now },
      },
      select: { id: true, organization_id: true },
    });
    if (expired.length === 0) return;

    await this.prismaService.db.subscription.updateMany({
      where: { id: { in: expired.map((s) => s.id) } },
      data: { status: SubscriptionStatus.EXPIRED, ends_at: now },
    });

    for (const row of expired) {
      this.eventBus.publish('subscription.expired', {
        subscription_id: row.id,
        organization_id: row.organization_id,
        expired_at: now.toISOString(),
      });
    }

    this.logger.log(`Expired ${expired.length} trial subscription(s)`);
  }
}
