import { Injectable } from '@nestjs/common';
import {
  BillingInterval,
  Prisma,
  SubscriptionAddOnStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { mapAddOns } from './admin-add-on.util.js';
import type { AdminSubscriptionsQueryDto } from './dto/admin-list-query.dto.js';
import type {
  AdminPlanOptionDto,
  AdminSubscriptionListItemDto,
  AdminSubscriptionStatsDto,
} from './dto/admin-read-response.dto.js';

type PriceRow = {
  billing_interval: BillingInterval;
  price: Prisma.Decimal;
  currency: string;
};

type Billing = {
  amount: number;
  currency: string;
  interval: 'MONTHLY' | 'YEARLY';
};

/**
 * Cross-tenant subscription list + headline stats for the admin dashboard. Per-row
 * `amount`/`mrr` are derived from the active PlanPrice (preferring MONTHLY, else
 * YEARLY ÷ 12) so the table reads true recurring revenue rather than verified-
 * payment cashflow — `stats()` aggregates the same way so the header equals the
 * column sum. Mirrors the price logic on AdminOrganizationsService.
 */
@Injectable()
export class AdminSubscriptionsService {
  constructor(private readonly prismaService: PrismaService) {}

  async list(query: AdminSubscriptionsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.SubscriptionWhereInput = {
      is_deleted: false,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            organization: {
              name: { contains: query.search, mode: 'insensitive' },
            },
          }
        : {}),
    };

    const [subs, total] = await Promise.all([
      this.prismaService.db.subscription.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          organization: true,
          subscription_plan: {
            include: {
              prices: { where: { is_active: true, is_deleted: false } },
            },
          },
          add_ons: {
            where: {
              status: SubscriptionAddOnStatus.ACTIVE,
              is_deleted: false,
            },
            include: {
              add_on: {
                include: {
                  prices: { where: { is_active: true, is_deleted: false } },
                },
              },
            },
          },
        },
      }),
      this.prismaService.db.subscription.count({ where }),
    ]);

    return paginated(
      subs.map((s): AdminSubscriptionListItemDto => {
        const billing = this.priceInfo(s.subscription_plan.prices);
        const add_ons = mapAddOns(s.add_ons, billing?.interval ?? null);
        return {
          id: s.id,
          organization_id: s.organization_id,
          organization_name: s.organization.name,
          plan: s.subscription_plan.plan,
          status: s.status,
          starts_at: s.starts_at,
          ends_at: s.ends_at,
          trial_ends_at: s.trial_ends_at,
          billing_interval: billing?.interval ?? null,
          amount: billing?.amount ?? null,
          currency: billing?.currency ?? null,
          mrr:
            s.status === SubscriptionStatus.ACTIVE
              ? this.monthlyEquivalent(billing)
              : null,
          add_on_count: add_ons.length,
          add_ons,
        };
      }),
      { page, limit, total },
    );
  }

  /** Global headline stats — counts by status, total MRR, and the plan mix. */
  async stats(): Promise<AdminSubscriptionStatsDto> {
    const [byStatus, byPlan, plans] = await Promise.all([
      this.prismaService.db.subscription.groupBy({
        by: ['status'],
        where: { is_deleted: false },
        _count: true,
      }),
      this.prismaService.db.subscription.groupBy({
        by: ['subscription_plan_id'],
        where: { is_deleted: false, status: SubscriptionStatus.ACTIVE },
        _count: true,
      }),
      this.prismaService.db.subscriptionPlan.findMany({
        include: { prices: { where: { is_active: true, is_deleted: false } } },
      }),
    ]);

    const counts = (status: SubscriptionStatus) =>
      byStatus.find((g) => g.status === status)?._count ?? 0;

    const planById = new Map(plans.map((p) => [p.id, p]));
    let mrr = 0;
    let currency = 'EGP';
    const plan_distribution = byPlan
      .map((g) => {
        const plan = planById.get(g.subscription_plan_id);
        const billing = plan ? this.priceInfo(plan.prices) : null;
        if (billing) currency = billing.currency;
        mrr += (this.monthlyEquivalent(billing) ?? 0) * g._count;
        return { plan: plan?.plan ?? 'unknown', count: g._count };
      })
      .sort((a, b) => b.count - a.count);

    return {
      total: byStatus.reduce((sum, g) => sum + g._count, 0),
      active: counts(SubscriptionStatus.ACTIVE),
      trial: counts(SubscriptionStatus.TRIAL),
      expired: counts(SubscriptionStatus.EXPIRED),
      cancelled: counts(SubscriptionStatus.CANCELLED),
      mrr: round2(mrr),
      currency,
      plan_distribution,
    };
  }

  /** Available plan tiers (smallest first) for the change-plan picker. */
  async plans(): Promise<AdminPlanOptionDto[]> {
    const plans = await this.prismaService.db.subscriptionPlan.findMany({
      orderBy: { max_staff: 'asc' },
      include: { prices: { where: { is_active: true, is_deleted: false } } },
    });
    return plans.map((p): AdminPlanOptionDto => {
      const billing = this.priceInfo(p.prices);
      return {
        plan: p.plan,
        max_branches: p.max_branches,
        max_staff: p.max_staff,
        amount: billing?.amount ?? null,
        currency: billing?.currency ?? null,
        billing_interval: billing?.interval ?? null,
      };
    });
  }

  /** Active plan price, preferring a monthly tier, else the yearly tier. */
  private priceInfo(prices: PriceRow[]): Billing | null {
    const monthly = prices.find(
      (p) => p.billing_interval === BillingInterval.MONTHLY,
    );
    if (monthly) {
      return {
        amount: round2(Number(monthly.price)),
        currency: monthly.currency,
        interval: 'MONTHLY',
      };
    }
    const yearly = prices.find(
      (p) => p.billing_interval === BillingInterval.YEARLY,
    );
    if (yearly) {
      return {
        amount: round2(Number(yearly.price)),
        currency: yearly.currency,
        interval: 'YEARLY',
      };
    }
    return null;
  }

  /** Monthly-equivalent figure for MRR (yearly prices divided by 12). */
  private monthlyEquivalent(billing: Billing | null): number | null {
    if (!billing) return null;
    return billing.interval === 'YEARLY'
      ? round2(billing.amount / 12)
      : billing.amount;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
