import { Injectable } from '@nestjs/common';
import { AdminNotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { paginated } from '@common/utils/pagination.utils.js';
import type { AdminNotificationsQueryDto } from './dto/admin-notification.dto.js';

export interface CreateAdminNotificationInput {
  type: AdminNotificationType;
  title: string;
  body: string;
  organization_id?: string | null;
  related_id?: string | null;
}

/**
 * Platform-wide admin notification feed. Shared across the small admin team, so
 * read-state is a single flag per notification rather than per-admin. Rows are
 * written by the AdminNotificationsListener from domain events.
 */
@Injectable()
export class AdminNotificationsService {
  constructor(private readonly prismaService: PrismaService) {}

  create(input: CreateAdminNotificationInput) {
    return this.prismaService.db.adminNotification.create({
      data: {
        type: input.type,
        title: input.title,
        body: input.body,
        organization_id: input.organization_id ?? null,
        related_id: input.related_id ?? null,
      },
    });
  }

  async list(query: AdminNotificationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.AdminNotificationWhereInput = {
      ...(query.unread ? { is_read: false } : {}),
    };

    const [items, total, unread_count] = await Promise.all([
      this.prismaService.db.adminNotification.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prismaService.db.adminNotification.count({ where }),
      this.prismaService.db.adminNotification.count({
        where: { is_read: false },
      }),
    ]);

    return paginated(items, { page, limit, total }, { unread_count });
  }

  async markRead(id: string): Promise<void> {
    await this.prismaService.db.adminNotification.updateMany({
      where: { id, is_read: false },
      data: { is_read: true },
    });
  }

  async markAllRead(): Promise<void> {
    await this.prismaService.db.adminNotification.updateMany({
      where: { is_read: false },
      data: { is_read: true },
    });
  }
}
