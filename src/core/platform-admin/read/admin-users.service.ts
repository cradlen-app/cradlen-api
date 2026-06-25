import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { paginated } from '@common/utils/pagination.utils.js';
import type { AdminListQueryDto } from './dto/admin-list-query.dto.js';
import type { AdminUserListItemDto } from './dto/admin-read-response.dto.js';

/**
 * Cross-tenant user directory for the admin dashboard. A User is one real person
 * (identity); its memberships across orgs are folded in as `profiles`. Search
 * matches name / email / phone.
 */
@Injectable()
export class AdminUsersService {
  constructor(private readonly prismaService: PrismaService) {}

  async list(query: AdminListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.UserWhereInput = {
      is_deleted: false,
      ...(query.search
        ? {
            OR: [
              { first_name: { contains: query.search, mode: 'insensitive' } },
              { last_name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone_number: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      this.prismaService.db.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          profiles: {
            where: { is_deleted: false },
            include: { organization: true, role: true },
          },
        },
      }),
      this.prismaService.db.user.count({ where }),
    ]);

    return paginated(
      users.map((u) => this.toListItem(u)),
      { page, limit, total },
    );
  }

  private toListItem(user: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    phone_number: string | null;
    is_active: boolean;
    created_at: Date;
    profiles: {
      id: string;
      organization_id: string;
      is_active: boolean;
      organization: { name: string };
      role: { code: string } | null;
    }[];
  }): AdminUserListItemDto {
    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      phone_number: user.phone_number,
      is_active: user.is_active,
      profile_count: user.profiles.length,
      profiles: user.profiles.map((p) => ({
        profile_id: p.id,
        organization_id: p.organization_id,
        organization_name: p.organization.name,
        role: p.role?.code ?? null,
        is_active: p.is_active,
      })),
      created_at: user.created_at,
    };
  }
}
