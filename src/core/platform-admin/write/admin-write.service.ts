import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  BillingInterval,
  OrganizationStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { SubscriptionsService } from '@core/org/subscriptions/subscriptions.service.js';
import { SubscriptionPaymentsService } from '@core/org/subscriptions/payments/subscription-payments.service.js';
import type { SubscriptionPaymentResponseDto } from '@core/org/subscriptions/payments/dto/subscription-payment-response.dto.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';

const BCRYPT_ROUNDS = 12;

/**
 * Platform-admin write actions across tenants. Every mutation records an
 * `admin_audit_log` row; for actions this service owns the transaction for
 * (subscription lifecycle + account moderation) the audit row is written inside
 * the same `$transaction` so the action and its log are atomic. Payment
 * verify/reject reuse SubscriptionPaymentsService (which owns its own
 * transaction); their audit row is written immediately after success.
 */
@Injectable()
export class AdminWriteService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly paymentsService: SubscriptionPaymentsService,
    private readonly audit: AdminAuditService,
  ) {}

  // ---- Payments -----------------------------------------------------------

  async verifyPayment(
    adminId: string,
    paymentId: string,
  ): Promise<SubscriptionPaymentResponseDto> {
    const result = await this.paymentsService.verifyPayment(paymentId, adminId);
    await this.audit.record({
      adminId,
      action: 'payment.verify',
      targetType: 'subscription_payment',
      targetId: paymentId,
      after: { status: result.status },
    });
    return result;
  }

  async rejectPayment(
    adminId: string,
    paymentId: string,
    reason: string,
  ): Promise<SubscriptionPaymentResponseDto> {
    const result = await this.paymentsService.rejectPayment(
      paymentId,
      reason,
      adminId,
    );
    await this.audit.record({
      adminId,
      action: 'payment.reject',
      targetType: 'subscription_payment',
      targetId: paymentId,
      after: { status: result.status, reason },
    });
    return result;
  }

  // ---- Subscription lifecycle --------------------------------------------

  /** Suspends a subscription (status EXPIRED) — blocks org writes, reversible. */
  suspendSubscription(adminId: string, id: string, reason?: string) {
    return this.setSubscriptionStatus(
      adminId,
      id,
      SubscriptionStatus.EXPIRED,
      'subscription.suspend',
      reason,
    );
  }

  /** Cancels a subscription (status CANCELLED). */
  cancelSubscription(adminId: string, id: string, reason?: string) {
    return this.setSubscriptionStatus(
      adminId,
      id,
      SubscriptionStatus.CANCELLED,
      'subscription.cancel',
      reason,
    );
  }

  /** Reactivates a suspended/cancelled subscription (status ACTIVE). */
  reactivateSubscription(adminId: string, id: string, reason?: string) {
    return this.setSubscriptionStatus(
      adminId,
      id,
      SubscriptionStatus.ACTIVE,
      'subscription.reactivate',
      reason,
    );
  }

  /** Extends a subscription's end date by `days` and sets it ACTIVE. */
  async extendSubscription(adminId: string, id: string, days: number) {
    const sub = await this.loadSubscriptionOrThrow(id);
    const now = new Date();
    const base = sub.ends_at && sub.ends_at > now ? sub.ends_at : now;
    const endsAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    const updated = await this.prismaService.db.$transaction(async (tx) => {
      const u = await tx.subscription.update({
        where: { id },
        data: { ends_at: endsAt, status: SubscriptionStatus.ACTIVE },
      });
      await this.audit.record(
        {
          adminId,
          action: 'subscription.extend',
          targetType: 'subscription',
          targetId: id,
          before: {
            status: sub.status,
            ends_at: sub.ends_at?.toISOString() ?? null,
          },
          after: { status: u.status, ends_at: endsAt.toISOString(), days },
        },
        tx,
      );
      return u;
    });
    this.subscriptionsService.bustStatusCache(sub.organization_id);
    return updated;
  }

  /** Switches the subscription onto a new plan for one YEARLY term (reuses activate). */
  async changePlan(adminId: string, id: string, planCode: string) {
    const sub = await this.loadSubscriptionOrThrow(id);
    const plan = await this.prismaService.db.subscriptionPlan.findUnique({
      where: { plan: planCode },
    });
    if (!plan) throw new NotFoundException(`Plan "${planCode}" not found`);

    const updated = await this.prismaService.db.$transaction(async (tx) => {
      const u = await this.subscriptionsService.activate(
        {
          organizationId: sub.organization_id,
          subscriptionPlanId: plan.id,
          billingInterval: BillingInterval.YEARLY,
        },
        tx,
      );
      await this.audit.record(
        {
          adminId,
          action: 'subscription.change_plan',
          targetType: 'subscription',
          targetId: id,
          before: { subscription_plan_id: sub.subscription_plan_id },
          after: { subscription_plan_id: plan.id, plan: planCode },
        },
        tx,
      );
      return u;
    });
    this.subscriptionsService.bustStatusCache(sub.organization_id);
    return updated;
  }

  // ---- Account / org moderation ------------------------------------------

  async suspendOrganization(adminId: string, id: string, reason?: string) {
    return this.setOrganizationStatus(
      adminId,
      id,
      OrganizationStatus.SUSPENDED,
      'organization.suspend',
      reason,
    );
  }

  async reactivateOrganization(adminId: string, id: string, reason?: string) {
    return this.setOrganizationStatus(
      adminId,
      id,
      OrganizationStatus.ACTIVE,
      'organization.reactivate',
      reason,
    );
  }

  deactivateUser(adminId: string, id: string, reason?: string) {
    return this.setUserActive(adminId, id, false, 'user.deactivate', reason);
  }

  reactivateUser(adminId: string, id: string, reason?: string) {
    return this.setUserActive(adminId, id, true, 'user.reactivate', reason);
  }

  /**
   * Sets a new password for a user and revokes their active sessions in the same
   * transaction, so a reset (e.g. after a suspected compromise) immediately
   * invalidates any session a holder of the old credentials still has. Mirrors
   * the staff password-reset flow.
   */
  async resetUserPassword(adminId: string, id: string, newPassword: string) {
    const user = await this.prismaService.db.user.findFirst({
      where: { id, is_deleted: false },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const password_hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prismaService.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { password_hashed, password_changed_at: new Date() },
      });
      await tx.refreshToken.updateMany({
        where: { user_id: id, is_revoked: false },
        data: { is_revoked: true, revoked_at: new Date() },
      });
      await this.audit.record(
        {
          adminId,
          action: 'user.reset_password',
          targetType: 'user',
          targetId: id,
        },
        tx,
      );
    });
    return { id };
  }

  // ---- shared helpers -----------------------------------------------------

  private async loadSubscriptionOrThrow(id: string) {
    const sub = await this.prismaService.db.subscription.findFirst({
      where: { id, is_deleted: false },
    });
    if (!sub) throw new NotFoundException('Subscription not found');
    return sub;
  }

  private async setSubscriptionStatus(
    adminId: string,
    id: string,
    status: SubscriptionStatus,
    action: string,
    reason?: string,
  ) {
    const sub = await this.loadSubscriptionOrThrow(id);
    const updated = await this.prismaService.db.$transaction(async (tx) => {
      const u = await tx.subscription.update({
        where: { id },
        data: { status },
      });
      await this.audit.record(
        {
          adminId,
          action,
          targetType: 'subscription',
          targetId: id,
          before: { status: sub.status },
          after: { status, ...(reason ? { reason } : {}) },
        },
        tx,
      );
      return u;
    });
    this.subscriptionsService.bustStatusCache(sub.organization_id);
    return updated;
  }

  private async setOrganizationStatus(
    adminId: string,
    id: string,
    status: OrganizationStatus,
    action: string,
    reason?: string,
  ) {
    const org = await this.prismaService.db.organization.findFirst({
      where: { id, is_deleted: false },
      select: { id: true, status: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return this.prismaService.db.$transaction(async (tx) => {
      const u = await tx.organization.update({
        where: { id },
        data: { status },
      });
      await this.audit.record(
        {
          adminId,
          action,
          targetType: 'organization',
          targetId: id,
          before: { status: org.status },
          after: { status, ...(reason ? { reason } : {}) },
        },
        tx,
      );
      return { id: u.id, status: u.status };
    });
  }

  private async setUserActive(
    adminId: string,
    id: string,
    isActive: boolean,
    action: string,
    reason?: string,
  ) {
    const user = await this.prismaService.db.user.findFirst({
      where: { id, is_deleted: false },
      select: { id: true, is_active: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.prismaService.db.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { is_active: isActive },
      });
      await this.audit.record(
        {
          adminId,
          action,
          targetType: 'user',
          targetId: id,
          before: { is_active: user.is_active },
          after: { is_active: isActive, ...(reason ? { reason } : {}) },
        },
        tx,
      );
      return { id: u.id, is_active: u.is_active };
    });
  }
}
