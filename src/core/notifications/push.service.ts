import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import webpush from 'web-push';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import pushConfig from '@config/push.config.js';
import type { PushSubscribeDto } from './dto/push.dto.js';

/**
 * Shape of the JSON the staff service worker expects in a push message. Mirrors
 * `PushPayload` in cradlen-web `src/app/sw.ts`.
 */
export interface ProfilePushPayload {
  title: string;
  body: string;
  navigate_to?: string | null;
  /** De-dupe key on the client; we pass the notification id so messages don't collapse. */
  tag?: string;
}

/**
 * Stores staff browser push subscriptions and fans a single profile's
 * notifications out to its registered devices. Delivery is best-effort: it never
 * throws into the caller (safe to call from `NotificationsService.create`), and
 * subscriptions the push service reports as gone (404/410) are pruned. Stays
 * inert when no VAPID keypair is configured. Mirrors AdminPushService.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
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
    profileId: string,
    dto: PushSubscribeDto,
    userAgent?: string | null,
  ): Promise<void> {
    await this.prismaService.db.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        profile_id: profileId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        user_agent: userAgent ?? null,
      },
      update: {
        profile_id: profileId,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        user_agent: userAgent ?? null,
      },
    });
  }

  /** Remove a subscription owned by this profile (scoped to avoid cross-profile deletes). */
  async unsubscribe(profileId: string, endpoint: string): Promise<void> {
    await this.prismaService.db.pushSubscription.deleteMany({
      where: { endpoint, profile_id: profileId },
    });
  }

  /** Fire-and-forget fan-out to one profile's devices. Safe to call from a hot path. */
  sendToProfile(profileId: string, payload: ProfilePushPayload): void {
    if (!this.enabled) return;
    void this.dispatch(profileId, payload);
  }

  private async dispatch(
    profileId: string,
    payload: ProfilePushPayload,
  ): Promise<void> {
    try {
      const subs = await this.prismaService.db.pushSubscription.findMany({
        where: { profile_id: profileId },
      });
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
        await this.prismaService.db.pushSubscription.deleteMany({
          where: { endpoint: { in: stale } },
        });
        this.logger.log(`Pruned ${stale.length} expired push subscription(s).`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to dispatch push notifications for profile ${profileId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
