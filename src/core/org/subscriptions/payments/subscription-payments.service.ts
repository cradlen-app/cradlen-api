import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingInterval,
  type SubscriptionPayment,
  type SubscriptionPaymentProof,
  SubscriptionPaymentStatus,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { SubscriptionsService } from '../subscriptions.service.js';
import {
  SUBSCRIPTION_EVENTS,
  type SubscriptionActivatedEvent,
  type SubscriptionPaymentRejectedEvent,
  type SubscriptionPaymentVerifiedEvent,
} from '../subscription.events.js';
import { PaymentProviderFactory } from './providers/payment-provider.factory.js';
import type { CreateSubscriptionPaymentDto } from './dto/create-subscription-payment.dto.js';
import type { ListSubscriptionPaymentsQueryDto } from './dto/list-subscription-payments-query.dto.js';
import type { SubscriptionPaymentResponseDto } from './dto/subscription-payment-response.dto.js';
import type { CreateSubscriptionPaymentResponseDto } from './dto/create-subscription-payment-response.dto.js';

/** A payment may still be cancelled / have proof added while in these states. */
const OPEN_STATUSES: SubscriptionPaymentStatus[] = [
  SubscriptionPaymentStatus.PENDING,
  SubscriptionPaymentStatus.AWAITING_VERIFICATION,
];

@Injectable()
export class SubscriptionPaymentsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly storageService: StorageService,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Creates a subscription payment for the chosen plan. Resolves the YEARLY
   * price, snapshots amount/currency onto the row, and asks the provider to
   * initiate (returning manual transfer instructions). OWNER-only.
   */
  async create(
    organizationId: string,
    dto: CreateSubscriptionPaymentDto,
    user: AuthContext,
  ): Promise<CreateSubscriptionPaymentResponseDto> {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );

    const plan = await this.prismaService.db.subscriptionPlan.findUnique({
      where: { plan: dto.plan },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.plan === 'free_trial') {
      throw new BadRequestException('The free trial plan cannot be purchased');
    }

    const price = await this.prismaService.db.planPrice.findFirst({
      where: {
        subscription_plan_id: plan.id,
        billing_interval: BillingInterval.YEARLY,
        is_active: true,
        is_deleted: false,
      },
    });
    if (!price) {
      throw new BadRequestException('No active price for this plan');
    }

    const subscription = await this.prismaService.db.subscription.findFirst({
      where: { organization_id: organizationId, is_deleted: false },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    });

    const payment = await this.prismaService.db.subscriptionPayment.create({
      data: {
        organization_id: organizationId,
        subscription_id: subscription?.id ?? null,
        subscription_plan_id: plan.id,
        plan_price_id: price.id,
        provider: dto.provider,
        billing_interval: BillingInterval.YEARLY,
        amount: price.price,
        currency: price.currency,
        status: SubscriptionPaymentStatus.PENDING,
        submitted_by_id: user.profileId,
      },
    });

    const provider = this.providerFactory.get(dto.provider);
    const initiated = await provider.initiate({
      paymentId: payment.id,
      amount: payment.amount.toString(),
      currency: payment.currency,
    });

    return {
      payment: this.toDto(payment),
      settlement_mode: initiated.settlement_mode,
      requires_proof: initiated.requires_proof,
      instructions: initiated.instructions,
      redirect_url: initiated.redirect_url,
    };
  }

  async list(
    organizationId: string,
    query: ListSubscriptionPaymentsQueryDto,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      organizationId,
    );
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      organization_id: organizationId,
      is_deleted: false,
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prismaService.db.subscriptionPayment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prismaService.db.subscriptionPayment.count({ where }),
    ]);

    return paginated(
      items.map((p) => this.toDto(p)),
      { page, limit, total },
    );
  }

  async get(
    organizationId: string,
    paymentId: string,
    user: AuthContext,
  ): Promise<SubscriptionPaymentResponseDto> {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      organizationId,
    );
    const payment = await this.findOwnedOrThrow(
      organizationId,
      paymentId,
      true,
    );
    const dto = this.toDto(payment);
    dto.proofs = await Promise.all(
      (payment.proofs ?? []).map(async (proof) => ({
        id: proof.id,
        url: await this.storageService.createPresignedDownloadUrl(
          proof.object_key,
        ),
        content_type: proof.content_type,
        size_bytes: proof.size_bytes,
        created_at: proof.created_at,
      })),
    );
    return dto;
  }

  /** Owner cancels a payment they no longer intend to complete (open states only). */
  async cancel(
    organizationId: string,
    paymentId: string,
    user: AuthContext,
  ): Promise<SubscriptionPaymentResponseDto> {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );
    const payment = await this.findOwnedOrThrow(organizationId, paymentId);
    if (!OPEN_STATUSES.includes(payment.status)) {
      throw new ConflictException(
        'Only a pending or awaiting-verification payment can be cancelled',
      );
    }
    const updated = await this.prismaService.db.subscriptionPayment.update({
      where: { id: payment.id },
      data: { status: SubscriptionPaymentStatus.CANCELLED },
    });
    return this.toDto(updated);
  }

  /**
   * Verifies an awaiting-verification payment and activates the org subscription
   * in one transaction. No HTTP route yet (DB-only verification): invoked by the
   * `verify-subscription-payment` script; a future platform-admin endpoint calls
   * the same method.
   */
  async verifyPayment(
    paymentId: string,
    verifierId: string | null = null,
  ): Promise<SubscriptionPaymentResponseDto> {
    const result = await this.prismaService.db.$transaction(async (tx) => {
      const payment = await tx.subscriptionPayment.findFirst({
        where: { id: paymentId, is_deleted: false },
      });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.status !== SubscriptionPaymentStatus.AWAITING_VERIFICATION) {
        throw new ConflictException(
          `Only an awaiting-verification payment can be verified (status: ${payment.status})`,
        );
      }

      const subscription = await this.subscriptionsService.activate(
        {
          organizationId: payment.organization_id,
          subscriptionPlanId: payment.subscription_plan_id,
          billingInterval: payment.billing_interval,
        },
        tx,
      );

      const updated = await tx.subscriptionPayment.update({
        where: { id: payment.id },
        data: {
          status: SubscriptionPaymentStatus.VERIFIED,
          verified_at: new Date(),
          verified_by_id: verifierId,
          subscription_id: subscription.id,
        },
      });
      return { updated, subscription };
    });

    this.eventBus.publish<SubscriptionPaymentVerifiedEvent>(
      SUBSCRIPTION_EVENTS.payment.verified,
      {
        payment_id: result.updated.id,
        organization_id: result.updated.organization_id,
        subscription_id: result.subscription.id,
        verified_by_id: verifierId,
      },
    );
    this.eventBus.publish<SubscriptionActivatedEvent>(
      SUBSCRIPTION_EVENTS.activated,
      {
        subscription_id: result.subscription.id,
        organization_id: result.updated.organization_id,
        subscription_plan_id: result.updated.subscription_plan_id,
        ends_at: (result.subscription.ends_at ?? new Date()).toISOString(),
      },
    );

    return this.toDto(result.updated);
  }

  /** Rejects an awaiting-verification payment (DB-only, like verify). */
  async rejectPayment(
    paymentId: string,
    reason: string,
    verifierId: string | null = null,
  ): Promise<SubscriptionPaymentResponseDto> {
    const payment = await this.prismaService.db.subscriptionPayment.findFirst({
      where: { id: paymentId, is_deleted: false },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== SubscriptionPaymentStatus.AWAITING_VERIFICATION) {
      throw new ConflictException(
        `Only an awaiting-verification payment can be rejected (status: ${payment.status})`,
      );
    }
    const updated = await this.prismaService.db.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: SubscriptionPaymentStatus.REJECTED,
        rejection_reason: reason,
        verified_by_id: verifierId,
      },
    });

    this.eventBus.publish<SubscriptionPaymentRejectedEvent>(
      SUBSCRIPTION_EVENTS.payment.rejected,
      {
        payment_id: updated.id,
        organization_id: updated.organization_id,
        reason,
      },
    );
    return this.toDto(updated);
  }

  private async findOwnedOrThrow(
    organizationId: string,
    paymentId: string,
    withProofs = false,
  ) {
    const payment = await this.prismaService.db.subscriptionPayment.findFirst({
      where: {
        id: paymentId,
        organization_id: organizationId,
        is_deleted: false,
      },
      include: withProofs
        ? { proofs: { where: { is_deleted: false } } }
        : undefined,
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment as SubscriptionPayment & {
      proofs?: SubscriptionPaymentProof[];
    };
  }

  private toDto(payment: SubscriptionPayment): SubscriptionPaymentResponseDto {
    return {
      id: payment.id,
      organization_id: payment.organization_id,
      subscription_plan_id: payment.subscription_plan_id,
      provider: payment.provider,
      billing_interval: payment.billing_interval,
      amount: payment.amount.toString(),
      currency: payment.currency,
      status: payment.status,
      rejection_reason: payment.rejection_reason,
      verified_at: payment.verified_at,
      created_at: payment.created_at,
    };
  }
}
