import { Injectable } from '@nestjs/common';
import { PricingSource } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

export interface ResolvePriceParams {
  organizationId: string;
  branchId: string;
  serviceId: string;
  profileId?: string;
}

export interface ResolvedPrice {
  price: Decimal;
  currency: string;
  source: PricingSource;
}

@Injectable()
export class PricingResolverService {
  constructor(private readonly prismaService: PrismaService) {}

  async resolvePrice(params: ResolvePriceParams): Promise<ResolvedPrice | null> {
    const { organizationId, branchId, serviceId, profileId } = params;
    const now = new Date();

    // 1. Provider price override (time-bounded)
    if (profileId) {
      const override = await this.prismaService.db.providerPriceOverride.findFirst({
        where: {
          profile_id: profileId,
          service_id: serviceId,
          organization_id: organizationId,
          is_active: true,
          is_deleted: false,
          AND: [
            { OR: [{ valid_from: null }, { valid_from: { lte: now } }] },
            { OR: [{ valid_to: null }, { valid_to: { gte: now } }] },
          ],
        },
      });
      if (override) {
        return { price: override.price, currency: override.currency, source: PricingSource.PROVIDER_OVERRIDE };
      }
    }

    // 2. Branch default price list
    const branchItem = await this.prismaService.db.priceListItem.findFirst({
      where: {
        service_id: serviceId,
        is_active: true,
        is_deleted: false,
        price_list: {
          branch_id: branchId,
          is_default: true,
          is_active: true,
          is_deleted: false,
        },
      },
      include: { price_list: { select: { currency: true } } },
    });
    if (branchItem) {
      return { price: branchItem.unit_price, currency: branchItem.price_list.currency, source: PricingSource.BRANCH_OVERRIDE };
    }

    // 3. Org default price list
    const orgItem = await this.prismaService.db.priceListItem.findFirst({
      where: {
        service_id: serviceId,
        is_active: true,
        is_deleted: false,
        price_list: {
          organization_id: organizationId,
          branch_id: null,
          is_default: true,
          is_active: true,
          is_deleted: false,
        },
      },
      include: { price_list: { select: { currency: true } } },
    });
    if (orgItem) {
      return { price: orgItem.unit_price, currency: orgItem.price_list.currency, source: PricingSource.ORG_PRICE_LIST };
    }

    return null;
  }
}
