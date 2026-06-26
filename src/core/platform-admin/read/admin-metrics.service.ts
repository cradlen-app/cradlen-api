import { Injectable } from '@nestjs/common';
import { SubscriptionStatus, SubscriptionPaymentStatus } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type {
  AdminMetricsOverviewDto,
  RevenuePointDto,
} from './dto/admin-metrics.dto.js';

const REVENUE_MONTHS = 8;

/**
 * Read-only aggregations for the admin Overview dashboard. Everything is derived
 * live from the operational tables — there is no precomputed metrics store — so
 * counts are exact at request time. Revenue is the sum of VERIFIED payments
 * bucketed by `verified_at`; the current bucket is treated as "monthly recurring
 * revenue" for the headline figure.
 */
@Injectable()
export class AdminMetricsService {
  constructor(private readonly prismaService: PrismaService) {}

  async getOverview(): Promise<AdminMetricsOverviewDto> {
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // First day of the oldest month in the trend window (inclusive).
    const windowStart = new Date(
      now.getFullYear(),
      now.getMonth() - (REVENUE_MONTHS - 1),
      1,
    );

    const db = this.prismaService.db;
    const [
      organizations_total,
      organizations_added_this_month,
      active_subscriptions,
      awaiting_payments_total,
      activeSubs,
      verifiedPayments,
      setting,
    ] = await Promise.all([
      db.organization.count({ where: { is_deleted: false } }),
      db.organization.count({
        where: { is_deleted: false, created_at: { gte: startOfThisMonth } },
      }),
      db.subscription.count({
        where: { is_deleted: false, status: SubscriptionStatus.ACTIVE },
      }),
      db.subscriptionPayment.count({
        where: {
          is_deleted: false,
          status: SubscriptionPaymentStatus.AWAITING_VERIFICATION,
        },
      }),
      db.subscription.findMany({
        where: { is_deleted: false, status: SubscriptionStatus.ACTIVE },
        select: { subscription_plan: { select: { plan: true } } },
      }),
      db.subscriptionPayment.findMany({
        where: {
          is_deleted: false,
          status: SubscriptionPaymentStatus.VERIFIED,
          verified_at: { gte: windowStart },
        },
        select: { amount: true, verified_at: true },
      }),
      db.platformSetting.findFirst(),
    ]);

    // Plan distribution — group active subscriptions by plan name.
    const planCounts = new Map<string, number>();
    for (const sub of activeSubs) {
      const plan = sub.subscription_plan.plan;
      planCounts.set(plan, (planCounts.get(plan) ?? 0) + 1);
    }
    const plan_distribution = [...planCounts.entries()]
      .map(([plan, count]) => ({ plan, count }))
      .sort((a, b) => b.count - a.count);

    // Revenue trend — seed every month in the window at 0, then fold payments in.
    const buckets = new Map<string, number>();
    for (let i = 0; i < REVENUE_MONTHS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.set(monthKey(d), 0);
    }
    for (const p of verifiedPayments) {
      if (!p.verified_at) continue;
      const key = monthKey(p.verified_at);
      if (buckets.has(key)) {
        buckets.set(key, (buckets.get(key) ?? 0) + Number(p.amount));
      }
    }
    const revenue_history: RevenuePointDto[] = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, amount: round2(amount) }));

    const current = revenue_history[revenue_history.length - 1]?.amount ?? 0;
    const previous = revenue_history[revenue_history.length - 2]?.amount ?? 0;
    const mrr_change_pct =
      previous > 0 ? round2(((current - previous) / previous) * 100) : null;

    return {
      organizations_total,
      organizations_added_this_month,
      active_subscriptions,
      awaiting_payments_total,
      currency: setting?.default_currency ?? 'EGP',
      monthly_recurring_revenue: current,
      mrr_change_pct,
      revenue_history,
      plan_distribution,
    };
  }
}

/** `YYYY-MM` key in local time, matching how the buckets are seeded. */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
