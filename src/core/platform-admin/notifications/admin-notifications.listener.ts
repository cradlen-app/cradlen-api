import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AdminNotificationType } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import {
  ORGANIZATION_EVENTS,
  type OrganizationCreatedEvent,
  type OrganizationTrialStartedEvent,
} from '@core/org/organizations/organization.events.js';
import {
  SUBSCRIPTION_EVENTS,
  type SubscriptionActivatedEvent,
  type SubscriptionPaymentSubmittedEvent,
} from '@core/org/subscriptions/subscription.events.js';
import { AdminNotificationsService } from './admin-notifications.service.js';

/**
 * Materializes platform domain events into the admin notification feed. Runs
 * after the publishing service returns, so a write failure here never fails the
 * customer-facing request; each handler logs and swallows its own errors.
 */
@Injectable()
export class AdminNotificationsListener {
  private readonly logger = new Logger(AdminNotificationsListener.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly notifications: AdminNotificationsService,
  ) {}

  @OnEvent(ORGANIZATION_EVENTS.created)
  async onOrganizationCreated(e: OrganizationCreatedEvent): Promise<void> {
    await this.safeCreate('organization.created', {
      type: AdminNotificationType.ORGANIZATION_CREATED,
      title: 'New organization',
      body: `${e.organization_name} just registered on the platform.`,
      organization_id: e.organization_id,
    });
  }

  @OnEvent(ORGANIZATION_EVENTS.trialStarted)
  async onTrialStarted(e: OrganizationTrialStartedEvent): Promise<void> {
    await this.safeCreate('organization.trial_started', {
      type: AdminNotificationType.SUBSCRIPTION_STARTED,
      title: 'New trial started',
      body: `${e.organization_name} started a free trial.`,
      organization_id: e.organization_id,
    });
  }

  @OnEvent(SUBSCRIPTION_EVENTS.payment.submitted)
  async onPaymentSubmitted(e: SubscriptionPaymentSubmittedEvent): Promise<void> {
    const orgName = await this.orgName(e.organization_id);
    await this.safeCreate('subscription_payment.submitted', {
      type: AdminNotificationType.PAYMENT_SUBMITTED,
      title: 'Payment awaiting verification',
      body: `${orgName} submitted a payment of ${e.amount} ${e.currency}.`,
      organization_id: e.organization_id,
      related_id: e.payment_id,
    });
  }

  @OnEvent(SUBSCRIPTION_EVENTS.activated)
  async onSubscriptionActivated(e: SubscriptionActivatedEvent): Promise<void> {
    const [orgName, plan] = await Promise.all([
      this.orgName(e.organization_id),
      this.planName(e.subscription_plan_id),
    ]);
    await this.safeCreate('subscription.activated', {
      type: AdminNotificationType.PLAN_CHANGED,
      title: 'Subscription activated',
      body: `${orgName} activated the ${plan} plan.`,
      organization_id: e.organization_id,
      related_id: e.subscription_id,
    });
  }

  private async orgName(id: string): Promise<string> {
    const org = await this.prismaService.db.organization.findUnique({
      where: { id },
      select: { name: true },
    });
    return org?.name ?? 'An organization';
  }

  private async planName(id: string): Promise<string> {
    const plan = await this.prismaService.db.subscriptionPlan.findUnique({
      where: { id },
      select: { plan: true },
    });
    return plan?.plan ?? 'a';
  }

  private async safeCreate(
    eventName: string,
    input: Parameters<AdminNotificationsService['create']>[0],
  ): Promise<void> {
    try {
      await this.notifications.create(input);
    } catch (error) {
      this.logger.error(
        `Failed to write admin notification for ${eventName}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
