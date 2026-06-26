import { BillingInterval, Prisma } from '@prisma/client';
import type { AdminSubscriptionAddOnDto } from './dto/admin-read-response.dto.js';

export type AddOnRow = {
  quantity: number;
  add_on: {
    name: string;
    kind: string;
    prices: {
      billing_interval: BillingInterval;
      price: Prisma.Decimal;
      currency: string;
    }[];
  };
};

/**
 * Maps ACTIVE subscription add-ons to the admin DTO, pricing each line at the
 * subscription's billing interval (the same interval `priceInfo()` derives from
 * the plan prices). A missing AddOnPrice for that interval yields null amounts so
 * the name/quantity still render. Shared by the subscriptions list and org detail.
 */
export function mapAddOns(
  addOns: AddOnRow[],
  interval: 'MONTHLY' | 'YEARLY' | null,
): AdminSubscriptionAddOnDto[] {
  return addOns.map((a) => {
    const price = interval
      ? a.add_on.prices.find((p) => p.billing_interval === interval)
      : undefined;
    const unit_amount = price ? round2(Number(price.price)) : null;
    return {
      name: a.add_on.name,
      kind: a.add_on.kind,
      quantity: a.quantity,
      unit_amount,
      amount: unit_amount != null ? round2(unit_amount * a.quantity) : null,
    };
  });
}

/**
 * Summed monthly-equivalent revenue of the (already interval-priced) add-on lines.
 * A YEARLY amount is divided by 12; a MONTHLY amount is taken as-is. Returns 0 when
 * there are no priced add-ons. Used to fold add-ons into derived MRR.
 */
export function addOnsMonthlyEquivalent(
  add_ons: { amount: number | null }[],
  interval: 'MONTHLY' | 'YEARLY' | null,
): number {
  const sum = add_ons.reduce((t, a) => t + (a.amount ?? 0), 0);
  return interval === 'YEARLY' ? round2(sum / 12) : round2(sum);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
