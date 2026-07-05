import { Injectable } from '@nestjs/common';
import { DiscountType, Prisma, PricingSource } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { Money } from '../shared/money/money.js';

export interface ResolvePriceParams {
  organizationId: string;
  branchId: string;
  serviceId: string;
  profileId?: string;
  /** Quantity being priced — selects the matching quantity-break tier. */
  quantity?: number;
  /**
   * Date the price applies to (the visit's scheduled date at booking). Promo
   * price-list windows and provider-override windows are matched against it.
   * Defaults to now for ad-hoc charges that carry no service date.
   */
  referenceDate?: Date;
}

export interface ResolvedPrice {
  /** Effective per-unit price (tier selected, discount applied). */
  price: Prisma.Decimal;
  /** Per-unit price before discount (the tier or base unit price). */
  base_price: Prisma.Decimal;
  /** Per-unit discount applied (base_price - price). */
  discount_amount: Prisma.Decimal;
  currency: string;
  source: PricingSource;
}

interface DiscountSource {
  discount_type: DiscountType | null;
  discount_value: Prisma.Decimal | null;
}

const PRICE_LIST_ITEM_INCLUDE = {
  tiers: true,
  price_list: {
    select: { currency: true, discount_type: true, discount_value: true },
  },
} satisfies Prisma.PriceListItemInclude;

@Injectable()
export class PricingResolverService {
  constructor(private readonly prismaService: PrismaService) {}

  async resolvePrice(
    params: ResolvePriceParams,
  ): Promise<ResolvedPrice | null> {
    const { organizationId, branchId, serviceId, profileId } = params;
    const quantity = params.quantity ?? 1;
    const referenceDate = params.referenceDate ?? new Date();

    // 1. Provider (doctor) price override — flat, explicit, branch-aware, and
    // only when the provider is authorized for the service.
    if (profileId) {
      const override = await this.resolveProviderOverride(
        profileId,
        serviceId,
        organizationId,
        branchId,
        referenceDate,
      );
      if (override) return override;
    }

    // Price-list resolution, most specific first. Within a scope a currently
    // in-window promotional list (non-default, date-bounded) beats the default
    // list; and the branch scope beats the org scope.
    const branchScope: Prisma.PriceListWhereInput = {
      branch_id: branchId,
      is_active: true,
      is_deleted: false,
    };
    const orgScope: Prisma.PriceListWhereInput = {
      organization_id: organizationId,
      branch_id: null,
      is_active: true,
      is_deleted: false,
    };

    // 2. Branch promotional (offer) list
    const branchOffer = await this.findOfferItem(
      branchScope,
      serviceId,
      referenceDate,
    );
    if (branchOffer) {
      return this.resolveFromItem(
        branchOffer,
        PricingSource.BRANCH_OVERRIDE,
        quantity,
      );
    }

    // 3. Branch default list
    const branchDefault = await this.findDefaultItem(branchScope, serviceId);
    if (branchDefault) {
      return this.resolveFromItem(
        branchDefault,
        PricingSource.BRANCH_OVERRIDE,
        quantity,
      );
    }

    // 4. Org promotional (offer) list
    const orgOffer = await this.findOfferItem(
      orgScope,
      serviceId,
      referenceDate,
    );
    if (orgOffer) {
      return this.resolveFromItem(
        orgOffer,
        PricingSource.ORG_PRICE_LIST,
        quantity,
      );
    }

    // 5. Org default list
    const orgDefault = await this.findDefaultItem(orgScope, serviceId);
    if (orgDefault) {
      return this.resolveFromItem(
        orgDefault,
        PricingSource.ORG_PRICE_LIST,
        quantity,
      );
    }

    return null;
  }

  /**
   * The scope's default price list item for the service, or null. The default
   * is the always-on baseline (typically no date window); it is not date-filtered
   * so it keeps applying whenever no promo is in effect.
   */
  private findDefaultItem(
    scope: Prisma.PriceListWhereInput,
    serviceId: string,
  ) {
    return this.prismaService.db.priceListItem.findFirst({
      where: {
        service_id: serviceId,
        is_active: true,
        is_deleted: false,
        price_list: { ...scope, is_default: true },
      },
      include: PRICE_LIST_ITEM_INCLUDE,
    });
  }

  /**
   * A currently-in-window promotional list item for the service, or null. A
   * promo is a non-default, date-bounded list (`valid_from` and/or `valid_to`
   * set) whose window covers `referenceDate`. The date guard keeps a plain
   * secondary list (no dates) from ever overriding the default. When windows
   * overlap the most-recently-started offer wins.
   */
  private findOfferItem(
    scope: Prisma.PriceListWhereInput,
    serviceId: string,
    referenceDate: Date,
  ) {
    return this.prismaService.db.priceListItem.findFirst({
      where: {
        service_id: serviceId,
        is_active: true,
        is_deleted: false,
        price_list: {
          ...scope,
          is_default: false,
          // Must be a dated (promotional) list, not a plain secondary list.
          OR: [{ valid_from: { not: null } }, { valid_to: { not: null } }],
          // Reference date within the window (open-ended nulls allowed).
          AND: [
            {
              OR: [
                { valid_from: null },
                { valid_from: { lte: referenceDate } },
              ],
            },
            { OR: [{ valid_to: null }, { valid_to: { gte: referenceDate } }] },
          ],
        },
      },
      include: PRICE_LIST_ITEM_INCLUDE,
      orderBy: [{ price_list: { valid_from: 'desc' } }, { created_at: 'desc' }],
    });
  }

  /**
   * A doctor override applies only if the provider is authorized (an active
   * ProviderService at this branch or org-wide). A branch-specific override
   * wins; the provider's org-wide override falls back; a different branch's
   * override never applies. Returns null to fall through to the price lists.
   */
  private async resolveProviderOverride(
    profileId: string,
    serviceId: string,
    organizationId: string,
    branchId: string,
    referenceDate: Date,
  ): Promise<ResolvedPrice | null> {
    const authorized = await this.prismaService.db.providerService.findFirst({
      where: {
        profile_id: profileId,
        service_id: serviceId,
        organization_id: organizationId,
        is_active: true,
        is_deleted: false,
        OR: [{ branch_id: branchId }, { branch_id: null }],
      },
      select: { id: true },
    });
    if (!authorized) return null;

    const timeBound: Prisma.ProviderPriceOverrideWhereInput = {
      profile_id: profileId,
      service_id: serviceId,
      organization_id: organizationId,
      is_active: true,
      is_deleted: false,
      AND: [
        { OR: [{ valid_from: null }, { valid_from: { lte: referenceDate } }] },
        { OR: [{ valid_to: null }, { valid_to: { gte: referenceDate } }] },
      ],
    };

    const override =
      (await this.prismaService.db.providerPriceOverride.findFirst({
        where: { ...timeBound, branch_id: branchId },
      })) ??
      (await this.prismaService.db.providerPriceOverride.findFirst({
        where: { ...timeBound, branch_id: null },
      }));

    if (!override) return null;
    return {
      price: override.price,
      base_price: override.price,
      discount_amount: Money.zero(),
      currency: override.currency,
      source: PricingSource.PROVIDER_OVERRIDE,
    };
  }

  private resolveFromItem(
    item: {
      unit_price: Prisma.Decimal;
      discount_type: DiscountType | null;
      discount_value: Prisma.Decimal | null;
      tiers: { min_quantity: number; unit_price: Prisma.Decimal }[];
      price_list: { currency: string } & DiscountSource;
    },
    source: PricingSource,
    quantity: number,
  ): ResolvedPrice {
    const base = this.pickTierPrice(item.unit_price, item.tiers, quantity);
    // Item discount overrides the list discount when present.
    const discount: DiscountSource =
      item.discount_type !== null
        ? {
            discount_type: item.discount_type,
            discount_value: item.discount_value,
          }
        : {
            discount_type: item.price_list.discount_type,
            discount_value: item.price_list.discount_value,
          };
    const price = this.applyDiscount(base, discount);

    return {
      price,
      base_price: base,
      discount_amount: Money.subtract(base, price),
      currency: item.price_list.currency,
      source,
    };
  }

  private pickTierPrice(
    unitPrice: Prisma.Decimal,
    tiers: { min_quantity: number; unit_price: Prisma.Decimal }[],
    quantity: number,
  ): Prisma.Decimal {
    let best = unitPrice;
    let bestMin = 0;
    for (const tier of tiers) {
      if (tier.min_quantity <= quantity && tier.min_quantity > bestMin) {
        best = tier.unit_price;
        bestMin = tier.min_quantity;
      }
    }
    return best;
  }

  private applyDiscount(
    base: Prisma.Decimal,
    discount: DiscountSource,
  ): Prisma.Decimal {
    if (discount.discount_type === null || discount.discount_value === null) {
      return base;
    }
    const amount =
      discount.discount_type === DiscountType.PERCENTAGE
        ? Money.round(
            Money.multiply(base, discount.discount_value).dividedBy(100),
          )
        : discount.discount_value;
    return Money.max(Money.zero(), Money.subtract(base, amount));
  }
}
