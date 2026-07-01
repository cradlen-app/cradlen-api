import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import webpush from 'web-push';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import pushConfig from '@config/push.config.js';
import type { PushSubscribeDto } from './dto/admin-push.dto.js';

/** Shape of the JSON the service worker expects in a push message. */
export interface AdminPushPayload {
  title: string;
  body: string;
  url: string;
}

/**
 * Stores admin browser push subscriptions and fans platform notifications out
 * to every registered device. Delivery is best-effort: it never throws into the
 * caller, and subscriptions the push service reports as gone (404/410) are
 * pruned. Stays inert when no VAPID keypair is configured.
 */
@Injectable()
export class AdminPushService implements OnModuleInit {
  private readonly logger = new Logger(AdminPushService.name);
  private enabled = false;

  constructor(
    @Inject(pushConfig.KEY)
    private readonly config: ConfigType<typeof pushConfig>,
    private readonly prismaService: PrismaService,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.warn(
        'Web Push disabled: VAPID keys are missing or the subject is invalid.',
      );
      return;
    }
    // Final safety net: even with a validated config, a malformed key can make
    // setVapidDetails throw. Never let an optional feature crash API startup.
    try {
      webpush.setVapidDetails(
        this.config.subject,
        this.config.publicKey,
        this.config.privateKey,
      );
      this.enabled = true;
    } catch (error) {
      this.logger.error(
        `Web Push disabled: failed to configure VAPID details (subject "${this.config.subject}"). ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Register (or refresh) a subscription. Endpoint is unique, so re-subscribe upserts. */
  async subscribe(
    adminId: string,
    dto: PushSubscribeDto,
    userAgent?: string | null,
  ): Promise<void> {
    await this.prismaService.db.adminPushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        admin_id: adminId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        user_agent: userAgent ?? null,
      },
      update: {
        admin_id: adminId,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        user_agent: userAgent ?? null,
      },
    });
  }

  /** Remove a subscription for this admin (scoped to the owner to avoid cross-admin deletes). */
  async unsubscribe(adminId: string, endpoint: string): Promise<void> {
    await this.prismaService.db.adminPushSubscription.deleteMany({
      where: { endpoint, admin_id: adminId },
    });
  }

  /** Fire-and-forget fan-out to all admin devices. Safe to call from a hot path. */
  sendToAllAdmins(payload: AdminPushPayload): void {
    if (!this.enabled) return;
    void this.dispatch(payload);
  }

  private async dispatch(payload: AdminPushPayload): Promise<void> {
    try {
      const subs = await this.prismaService.db.adminPushSubscription.findMany();
      if (subs.length === 0) return;

      const body = JSON.stringify(payload);
      const stale: string[] = [];

      await Promise.all(
        subs.map(async (sub) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              body,
            );
          } catch (error) {
            const statusCode = (error as { statusCode?: number }).statusCode;
            if (statusCode === 404 || statusCode === 410) {
              stale.push(sub.endpoint);
            } else {
              this.logger.warn(
                `Push send failed (status ${statusCode ?? 'n/a'}) for ${sub.endpoint}`,
              );
            }
          }
        }),
      );

      if (stale.length > 0) {
        await this.prismaService.db.adminPushSubscription.deleteMany({
          where: { endpoint: { in: stale } },
        });
        this.logger.log(`Pruned ${stale.length} expired push subscription(s).`);
      }
    } catch (error) {
      this.logger.error(
        'Failed to dispatch admin push notifications',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
