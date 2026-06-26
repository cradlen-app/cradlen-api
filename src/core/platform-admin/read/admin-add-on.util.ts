import { BillingInterval, Prisma } from '@prisma/client';
import type { AdminSubscriptionAddOnDto } from './dto/admin-read-response.dto.js';

type AddOnRow = {
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
