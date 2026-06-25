import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { paginated } from '@common/utils/pagination.utils.js';
import type { AdminSubscriptionsQueryDto } from './dto/admin-list-query.dto.js';
import type { AdminSubscriptionListItemDto } from './dto/admin-read-response.dto.js';

/** Cross-tenant subscription list for the admin dashboard. */
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
        include: { organization: true, subscription_plan: true },
      }),
      this.prismaService.db.subscription.count({ where }),
    ]);

    return paginated(
      subs.map(
        (s): AdminSubscriptionListItemDto => ({
          id: s.id,
          organization_id: s.organization_id,
          organization_name: s.organization.name,
          plan: s.subscription_plan.plan,
          status: s.status,
          starts_at: s.starts_at,
          ends_at: s.ends_at,
          trial_ends_at: s.trial_ends_at,
        }),
      ),
      { page, limit, total },
    );
  }
}
