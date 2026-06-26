import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { paginated } from '@common/utils/pagination.utils.js';
import type { AdminOrganizationsQueryDto } from './dto/admin-list-query.dto.js';
import type {
  AdminOrganizationDetailDto,
  AdminOrganizationListItemDto,
} from './dto/admin-read-response.dto.js';

/**
 * Cross-tenant read of organizations for the admin dashboard. No org-membership
 * gate — the AdminJwtAuthGuard is the only authority (platform admins see every
 * tenant). Folds in branch/staff counts and the org's current subscription.
 */
@Injectable()
export class AdminOrganizationsService {
  constructor(private readonly prismaService: PrismaService) {}

  async list(query: AdminOrganizationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.OrganizationWhereInput = {
      is_deleted: false,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };

    const [orgs, total] = await Promise.all([
      this.prismaService.db.organization.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          _count: {
            select: {
              branches: { where: { is_deleted: false } },
              profiles: { where: { is_deleted: false, is_active: true } },
            },
          },
          subscriptions: {
            where: { is_deleted: false },
            orderBy: { created_at: 'desc' },
            take: 1,
            include: { subscription_plan: true },
          },
          branches: {
            where: { is_deleted: false },
            orderBy: { is_main: 'desc' },
            take: 1,
            select: { city: true },
          },
        },
      }),
      this.prismaService.db.organization.count({ where }),
    ]);

    return paginated(
      orgs.map((o) => this.toListItem(o)),
      { page, limit, total },
    );
  }

  async get(id: string): Promise<AdminOrganizationDetailDto> {
    const org = await this.prismaService.db.organization.findFirst({
      where: { id, is_deleted: false },
      include: {
        _count: {
          select: {
            branches: { where: { is_deleted: false } },
            profiles: { where: { is_deleted: false, is_active: true } },
          },
        },
        subscriptions: {
          where: { is_deleted: false },
          orderBy: { created_at: 'desc' },
          take: 1,
          include: { subscription_plan: true },
        },
        branches: {
          where: { is_deleted: false },
          orderBy: { is_main: 'desc' },
          take: 1,
          select: { city: true },
        },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const sub = org.subscriptions[0] ?? null;
    return {
      ...this.toListItem(org),
      subscription_ends_at: sub?.ends_at ?? null,
      trial_ends_at: sub?.trial_ends_at ?? null,
    };
  }

  private toListItem(org: {
    id: string;
    name: string;
    status: AdminOrganizationListItemDto['status'];
    created_at: Date;
    _count: { branches: number; profiles: number };
    subscriptions: { status: string; subscription_plan: { plan: string } }[];
    branches: { city: string }[];
  }): AdminOrganizationListItemDto {
    const sub = org.subscriptions[0] ?? null;
    return {
      id: org.id,
      name: org.name,
      status: org.status,
      branch_count: org._count.branches,
      staff_count: org._count.profiles,
      subscription_status:
        (sub?.status as AdminOrganizationListItemDto['subscription_status']) ??
        null,
      plan: sub?.subscription_plan.plan ?? null,
      city: org.branches[0]?.city ?? null,
      created_at: org.created_at,
    };
  }
}
