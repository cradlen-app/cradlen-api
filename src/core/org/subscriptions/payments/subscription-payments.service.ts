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
  type SubscriptionPaymentItem,
  SubscriptionPaymentItemKind,
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

    const payment =
      dto.add_ons && dto.add_ons.length > 0
        ? await this.createCombinedPayment(organizationId, dto, user)
        : dto.add_on_code
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

    // Block a plan purchase the org doesn't fit (e.g. trial with 5 staff buying
    // Individual/2). The owner is told before paying; the combined plan+seats
    // checkout is the alternative that keeps everyone.
    await this.subscriptionsService.assertUsageFitsPlan(
      organizationId,
      plan.id,
    );

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
   * Builds a PENDING combined payment: one base plan + one or more add-ons in a
   * single amount/proof. The add-ons are validated against the TARGET plan (the
   * org will be on it once verified) and charged full-term — they are co-terminus
   * with the freshly-activated year, so no proration. Lets an owner switch plans
   * AND buy enough seats to keep all their staff in one transaction.
   */
  private async createCombinedPayment(
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

    const planPrice = await this.prismaService.db.planPrice.findFirst({
      where: {
        subscription_plan_id: plan.id,
        billing_interval: BillingInterval.YEARLY,
        is_active: true,
        is_deleted: false,
      },
    });
    if (!planPrice) {
      throw new BadRequestException('No active price for this plan');
    }

    const addOnLines = await Promise.all(
      (dto.add_ons ?? []).map(async (line) => {
        const addOn = await this.prismaService.db.addOn.findFirst({
          where: { code: line.code, is_deleted: false, is_active: true },
        });
        if (!addOn) {
          throw new NotFoundException(`Add-on not found: ${line.code}`);
        }
        if (addOn.subscription_plan_id !== plan.id) {
          throw new BadRequestException(
            `Add-on ${line.code} is not available for the ${plan.plan} plan`,
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
          throw new BadRequestException(
            `No active price for add-on ${line.code}`,
          );
        }
        return {
          addOn,
          quantity: line.quantity,
          unit_amount: price.price,
          amount: price.price.mul(line.quantity).toDecimalPlaces(2),
          currency: price.currency,
        };
      }),
    );

    const currencies = new Set([
      planPrice.currency,
      ...addOnLines.map((l) => l.currency),
    ]);
    if (currencies.size > 1) {
      throw new BadRequestException(
        'All checkout lines must share a single currency',
      );
    }

    // The cart's seats count toward the target plan, so a sufficiently-seated
    // combined checkout passes; an under-seated one is rejected the same way a
    // plain over-limit downgrade is.
    await this.subscriptionsService.assertUsageFitsPlan(
      organizationId,
      plan.id,
      {
        cartAddOns: addOnLines.map((l) => ({
          addOnId: l.addOn.id,
          quantity: l.quantity,
        })),
      },
    );

    const totalAmount = addOnLines.reduce(
      (sum, l) => sum.add(l.amount),
      planPrice.price,
    );

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
        plan_price_id: planPrice.id,
        purpose: SubscriptionPaymentPurpose.COMBINED,
        provider: dto.provider,
        billing_interval: BillingInterval.YEARLY,
        amount: totalAmount,
        currency: planPrice.currency,
        status: SubscriptionPaymentStatus.PENDING,
        submitted_by_id: user.profileId,
        items: {
          create: [
            {
              kind: SubscriptionPaymentItemKind.PLAN,
              subscription_plan_id: plan.id,
              plan_price_id: planPrice.id,
              quantity: 1,
              unit_amount: planPrice.price,
              amount: planPrice.price,
            },
            ...addOnLines.map((l) => ({
              kind: SubscriptionPaymentItemKind.ADD_ON,
              add_on_id: l.addOn.id,
              quantity: l.quantity,
              unit_amount: l.unit_amount,
              amount: l.amount,
            })),
          ],
        },
      },
      include: { items: true },
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

      const grantedAddOns: { add_on_id: string; quantity: number }[] = [];
      let subscription;

      if (payment.purpose === SubscriptionPaymentPurpose.ADD_ON) {
        subscription = await this.resolveSubscription(tx, payment);
        if (!payment.add_on_id) {
          throw new ConflictException('Add-on payment is missing its add-on');
        }
        await this.grantAddOn(
          tx,
          subscription,
          payment.add_on_id,
          payment.quantity,
        );
        grantedAddOns.push({
          add_on_id: payment.add_on_id,
          quantity: payment.quantity,
        });
      } else if (payment.purpose === SubscriptionPaymentPurpose.COMBINED) {
        const items = await tx.subscriptionPaymentItem.findMany({
          where: { subscription_payment_id: payment.id, is_deleted: false },
        });
        const planId =
          items.find((i) => i.kind === SubscriptionPaymentItemKind.PLAN)
            ?.subscription_plan_id ?? payment.subscription_plan_id;
        const addOnItems = items.filter(
          (i) =>
            i.kind === SubscriptionPaymentItemKind.ADD_ON &&
            i.add_on_id != null,
        );
        // Defensive: usage must still fit the plan base + this cart's seats.
        await this.subscriptionsService.assertUsageFitsPlan(
          payment.organization_id,
          planId,
          {
            cartAddOns: addOnItems.map((i) => ({
              addOnId: i.add_on_id!,
              quantity: i.quantity,
            })),
          },
          tx,
        );
        // Activate the plan first so the term/ends_at is set, then grant each
        // add-on co-terminus with the freshly-activated subscription.
        subscription = await this.subscriptionsService.activate(
          {
            organizationId: payment.organization_id,
            subscriptionPlanId: planId,
            billingInterval: payment.billing_interval,
          },
          tx,
        );
        for (const item of addOnItems) {
          await this.grantAddOn(
            tx,
            subscription,
            item.add_on_id!,
            item.quantity,
          );
          grantedAddOns.push({
            add_on_id: item.add_on_id!,
            quantity: item.quantity,
          });
        }
      } else {
        // PLAN: defensive fit re-check before activating.
        await this.subscriptionsService.assertUsageFitsPlan(
          payment.organization_id,
          payment.subscription_plan_id,
          {},
          tx,
        );
        subscription = await this.subscriptionsService.activate(
          {
            organizationId: payment.organization_id,
            subscriptionPlanId: payment.subscription_plan_id,
            billingInterval: payment.billing_interval,
          },
          tx,
        );
      }

      const updated = await tx.subscriptionPayment.update({
        where: { id: payment.id },
        data: {
          status: SubscriptionPaymentStatus.VERIFIED,
          verified_at: new Date(),
          verified_by_id: verifierId,
          subscription_id: subscription.id,
        },
      });
      return { updated, subscription, grantedAddOns };
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

    // A COMBINED / PLAN payment activates the plan; ADD_ON does not. Both
    // COMBINED and ADD_ON may grant one or more add-ons.
    if (result.updated.purpose !== SubscriptionPaymentPurpose.ADD_ON) {
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
    for (const grant of result.grantedAddOns) {
      this.eventBus.publish<SubscriptionAddOnGrantedEvent>(
        SUBSCRIPTION_EVENTS.addon.granted,
        {
          payment_id: result.updated.id,
          organization_id: result.updated.organization_id,
          subscription_id: result.subscription.id,
          add_on_id: grant.add_on_id,
          quantity: grant.quantity,
          verified_by_id: verifierId,
        },
      );
    }

    return this.toDto(result.updated);
  }

  /** Resolves the payment's target subscription (by id, else the org's latest). */
  private async resolveSubscription(
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
    return subscription;
  }

  /**
   * Grants (or increments) one add-on on a subscription, co-terminus with the
   * subscription's current `ends_at`. Reused per line by the ADD_ON and COMBINED
   * verify branches. Runs inside verify's txn. A row that was previously
   * CANCELLED (e.g. by a plan change) or soft-deleted is reset to the purchased
   * quantity — incrementing its stale quantity would grant capacity that was
   * never paid for.
   */
  private async grantAddOn(
    tx: Prisma.TransactionClient,
    subscription: { id: string; ends_at: Date | null },
    addOnId: string,
    quantity: number,
  ): Promise<void> {
    const existing = await tx.subscriptionAddOn.findUnique({
      where: {
        subscription_id_add_on_id: {
          subscription_id: subscription.id,
          add_on_id: addOnId,
        },
      },
    });
    if (!existing) {
      await tx.subscriptionAddOn.create({
        data: {
          subscription_id: subscription.id,
          add_on_id: addOnId,
          quantity,
          status: SubscriptionAddOnStatus.ACTIVE,
          ends_at: subscription.ends_at,
        },
      });
      return;
    }
    const isLiveGrant =
      existing.status === SubscriptionAddOnStatus.ACTIVE &&
      !existing.is_deleted;
    await tx.subscriptionAddOn.update({
      where: { id: existing.id },
      data: {
        quantity: isLiveGrant ? { increment: quantity } : quantity,
        status: SubscriptionAddOnStatus.ACTIVE,
        ...(isLiveGrant ? {} : { starts_at: new Date() }),
        ends_at: subscription.ends_at,
        is_deleted: false,
        deleted_at: null,
      },
    });
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
        ? {
            proofs: { where: { is_deleted: false } },
            items: { where: { is_deleted: false } },
          }
        : { items: { where: { is_deleted: false } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment as SubscriptionPayment & {
      proofs?: SubscriptionPaymentProof[];
      items?: SubscriptionPaymentItem[];
    };
  }

  private toDto(
    payment: SubscriptionPayment & {
      items?: SubscriptionPaymentItem[];
    },
  ): SubscriptionPaymentResponseDto {
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
      ...(payment.items
        ? {
            items: payment.items
              .filter((i) => !i.is_deleted)
              .map((i) => ({
                id: i.id,
                kind: i.kind,
                subscription_plan_id: i.subscription_plan_id,
                add_on_id: i.add_on_id,
                quantity: i.quantity,
                unit_amount: i.unit_amount.toString(),
                amount: i.amount.toString(),
              })),
          }
        : {}),
    };
  }
}
