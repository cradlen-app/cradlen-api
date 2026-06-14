import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { SubscriptionPlanResponseDto } from './dto/subscription-plan-response.dto.js';

/**
 * Read-only catalog of subscription plan tiers + their active prices. Plans are
 * seed-managed (no admin CRUD); the pricing page renders this.
 */
@Injectable()
export class SubscriptionPlansService {
  constructor(private readonly prismaService: PrismaService) {}

  async list(): Promise<SubscriptionPlanResponseDto[]> {
    const plans = await this.prismaService.db.subscriptionPlan.findMany({
      include: {
        prices: {
          where: { is_active: true, is_deleted: false },
          orderBy: { billing_interval: 'asc' },
        },
      },
      orderBy: { max_staff: 'asc' },
    });

    return plans.map((plan) => ({
      id: plan.id,
      plan: plan.plan,
      max_organizations: plan.max_organizations,
      max_branches: plan.max_branches,
      max_staff: plan.max_staff,
      prices: plan.prices.map((price) => ({
        billing_interval: price.billing_interval,
        price: price.price.toString(),
        currency: price.currency,
      })),
    }));
  }
}
