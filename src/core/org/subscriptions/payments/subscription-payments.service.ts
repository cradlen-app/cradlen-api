import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingInterval,
  Prisma,
  SubscriptionAddOnStatus,
  type SubscriptionPayment,
  type SubscriptionPaymentProof,
  SubscriptionPaymentPurpose,
  SubscriptionPaymentStatus,
  SubscriptionStatus,
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
  type SubscriptionAddOnGrantedEvent,
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

    const payment = dto.add_on_code
      ? await this.createAddOnPayment(organizationId, dto, user)
      : await this.createPlanPayment(organizationId, dto, user);

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

  /** Builds a PENDING payment for a base-plan purchase/renewal (full yearly price). */
  private async createPlanPayment(
    organizationId: string,
    dto: CreateSubscriptionPaymentDto,
    user: AuthContext,
  ): Promise<SubscriptionPayment> {
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

    return this.prismaService.db.subscriptionPayment.create({
      data: {
        organization_id: organizationId,
        subscription_id: subscription?.id ?? null,
        subscription_plan_id: plan.id,
        plan_price_id: price.id,
        purpose: SubscriptionPaymentPurpose.PLAN,
        provider: dto.provider,
        billing_interval: BillingInterval.YEARLY,
        amount: price.price,
        currency: price.currency,
        status: SubscriptionPaymentStatus.PENDING,
        submitted_by_id: user.profileId,
      },
    });
  }

  /**
   * Builds a PENDING payment for an add-on purchase. The add-on must belong to
   * the org's current (ACTIVE, unexpired) plan; the amount is the YEARLY add-on
   * price prorated to the days remaining in the current term so it is co-terminus
   * with the base subscription.
   */
  private async createAddOnPayment(
    organizationId: string,
    dto: CreateSubscriptionPaymentDto,
    user: AuthContext,
  ): Promise<SubscriptionPayment> {
    const now = new Date();
    const subscription = await this.prismaService.db.subscription.findFirst({
      where: { organization_id: organizationId, is_deleted: false },
      orderBy: { created_at: 'desc' },
    });
    if (
      !subscription ||
      subscription.status !== SubscriptionStatus.ACTIVE ||
      !subscription.ends_at ||
      subscription.ends_at <= now
    ) {
      throw new BadRequestException(
        'Add-ons require an active paid subscription. Activate or renew a plan first.',
      );
    }

    const addOn = await this.prismaService.db.addOn.findFirst({
      where: { code: dto.add_on_code, is_deleted: false, is_active: true },
    });
    if (!addOn) throw new NotFoundException('Add-on not found');
    if (addOn.subscription_plan_id !== subscription.subscription_plan_id) {
      throw new BadRequestException(
        'This add-on is not available for your current plan',
      );
    }

    const price = await this.prismaService.db.addOnPrice.findFirst({
      where: {
        add_on_id: addOn.id,
        billing_interval: BillingInterval.YEARLY,
        is_active: true,
        is_deleted: false,
      },
    });
    if (!price) {
      throw new BadRequestException('No active price for this add-on');
    }

    const quantity = dto.quantity ?? 1;
    const amount = this.prorate(
      price.price,
      quantity,
      now,
      subscription.ends_at,
    );

    return this.prismaService.db.subscriptionPayment.create({
      data: {
        organization_id: organizationId,
        subscription_id: subscription.id,
        subscription_plan_id: subscription.subscription_plan_id,
        purpose: SubscriptionPaymentPurpose.ADD_ON,
        add_on_id: addOn.id,
        quantity,
        provider: dto.provider,
        billing_interval: BillingInterval.YEARLY,
        amount,
        currency: price.currency,
        status: SubscriptionPaymentStatus.PENDING,
        submitted_by_id: user.profileId,
      },
    });
  }

  /**
   * Prorates a yearly price to the days remaining until `endsAt`:
   * `price × quantity × daysRemaining / 365`, rounded to 2 decimals. Clamped to
   * at least 1 day so a same-day purchase still charges something.
   */
  private prorate(
    yearlyPrice: Prisma.Decimal,
    quantity: number,
    from: Date,
    endsAt: Date,
  ): Prisma.Decimal {
    const dayMs = 24 * 60 * 60 * 1000;
    const daysRemaining = Math.max(
      1,
      Math.ceil((endsAt.getTime() - from.getTime()) / dayMs),
    );
    return yearlyPrice
      .mul(quantity)
      .mul(daysRemaining)
      .div(365)
      .toDecimalPlaces(2);
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

      const subscription =
        payment.purpose === SubscriptionPaymentPurpose.ADD_ON
          ? await this.grantAddOn(tx, payment)
          : await this.subscriptionsService.activate(
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

    if (result.updated.purpose === SubscriptionPaymentPurpose.ADD_ON) {
      this.eventBus.publish<SubscriptionAddOnGrantedEvent>(
        SUBSCRIPTION_EVENTS.addon.granted,
        {
          payment_id: result.updated.id,
          organization_id: result.updated.organization_id,
          subscription_id: result.subscription.id,
          add_on_id: result.updated.add_on_id!,
          quantity: result.updated.quantity,
          verified_by_id: verifierId,
        },
      );
    } else {
      this.eventBus.publish<SubscriptionActivatedEvent>(
        SUBSCRIPTION_EVENTS.activated,
        {
          subscription_id: result.subscription.id,
          organization_id: result.updated.organization_id,
          subscription_plan_id: result.updated.subscription_plan_id,
          ends_at: (result.subscription.ends_at ?? new Date()).toISOString(),
        },
      );
    }

    return this.toDto(result.updated);
  }

  /**
   * Grants (or increments) the add-on on the payment's subscription, co-terminus
   * with the subscription's current `ends_at`. Returns the subscription so the
   * caller can stamp the payment + publish events. Runs inside verify's txn.
   */
  private async grantAddOn(
    tx: Prisma.TransactionClient,
    payment: SubscriptionPayment,
  ) {
    const subscription = await tx.subscription.findFirst({
      where: payment.subscription_id
        ? { id: payment.subscription_id }
        : { organization_id: payment.organization_id, is_deleted: false },
      orderBy: { created_at: 'desc' },
    });
    if (!subscription) {
      throw new ConflictException(
        'Cannot grant an add-on: the organization has no subscription',
      );
    }
    if (!payment.add_on_id) {
      throw new ConflictException('Add-on payment is missing its add-on');
    }

    await tx.subscriptionAddOn.upsert({
      where: {
        subscription_id_add_on_id: {
          subscription_id: subscription.id,
          add_on_id: payment.add_on_id,
        },
      },
      update: {
        quantity: { increment: payment.quantity },
        status: SubscriptionAddOnStatus.ACTIVE,
        ends_at: subscription.ends_at,
        is_deleted: false,
        deleted_at: null,
      },
      create: {
        subscription_id: subscription.id,
        add_on_id: payment.add_on_id,
        quantity: payment.quantity,
        status: SubscriptionAddOnStatus.ACTIVE,
        ends_at: subscription.ends_at,
      },
    });

    return subscription;
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
      purpose: payment.purpose,
      add_on_id: payment.add_on_id,
      quantity: payment.quantity,
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
