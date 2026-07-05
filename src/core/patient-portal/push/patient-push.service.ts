import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import webpush from 'web-push';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import pushConfig from '@config/push.config.js';
import type { PushSubscribeDto } from './dto/patient-push.dto.js';

/**
 * Shape of the JSON the patient service worker expects in a push message.
 * Mirrors `PushPayload` in cradlen-patient `src/app/sw.ts` and staff
 * `ProfilePushPayload`.
 */
export interface PatientPushPayload {
  title: string;
  body: string;
  navigate_to?: string | null;
  /** De-dupe key on the client; we pass the notification id so messages don't collapse. */
  tag?: string;
}

/**
 * Stores patient browser push subscriptions and fans a patient's notifications
 * out to every account that can access that patient — the patient's own login
 * account plus any guardian accounts. Delivery is best-effort: it never throws
 * into the caller (safe to call from the notifications listener), and
 * subscriptions the push service reports as gone (404/410) are pruned. Stays
 * inert when no VAPID keypair is configured. Mirrors PushService.
 */
@Injectable()
export class PatientPushService implements OnModuleInit {
  private readonly logger = new Logger(PatientPushService.name);
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
    accountId: string,
    dto: PushSubscribeDto,
    userAgent?: string | null,
  ): Promise<void> {
    await this.prismaService.db.patientPushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        account_id: accountId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        user_agent: userAgent ?? null,
      },
      update: {
        account_id: accountId,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        user_agent: userAgent ?? null,
      },
    });
  }

  /** Remove a subscription owned by this account (scoped to avoid cross-account deletes). */
  async unsubscribe(accountId: string, endpoint: string): Promise<void> {
    await this.prismaService.db.patientPushSubscription.deleteMany({
      where: { endpoint, account_id: accountId },
    });
  }

  /**
   * Fire-and-forget fan-out to every device of every account that can access
   * `patientId`. Safe to call from a hot path.
   */
  sendToPatient(patientId: string, payload: PatientPushPayload): void {
    if (!this.enabled) return;
    void this.dispatch(patientId, payload);
  }

  private async dispatch(
    patientId: string,
    payload: PatientPushPayload,
  ): Promise<void> {
    try {
      // 1. Resolve every account that can access this patient: the patient's
      //    own login account, plus any guardian accounts linked to them.
      const guardianLinks =
        await this.prismaService.db.patientGuardian.findMany({
          where: { patient_id: patientId, is_deleted: false },
          select: { guardian_id: true },
        });
      const guardianIds = guardianLinks.map((l) => l.guardian_id);

      const accounts = await this.prismaService.db.patientAccount.findMany({
        where: {
          is_active: true,
          is_deleted: false,
          OR: [
            { patient_id: patientId },
            ...(guardianIds.length > 0
              ? [{ guardian_id: { in: guardianIds } }]
              : []),
          ],
        },
        select: { id: true },
      });
      const accountIds = accounts.map((a) => a.id);
      if (accountIds.length === 0) return;

      // 2. Load their subscriptions and push.
      const subs = await this.prismaService.db.patientPushSubscription.findMany(
        {
          where: { account_id: { in: accountIds } },
        },
      );
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
        await this.prismaService.db.patientPushSubscription.deleteMany({
          where: { endpoint: { in: stale } },
        });
        this.logger.log(`Pruned ${stale.length} expired push subscription(s).`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to dispatch patient push notifications for patient ${patientId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
