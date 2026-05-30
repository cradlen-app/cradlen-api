import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { toNotificationResponse } from './notifications.mapper.js';

interface CreateNotificationInput {
  profileId: string;
  code: string;
  category: string;
  title: string;
  description: string;
  navigateTo?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(input: CreateNotificationInput) {
    return this.prismaService.db.notification.create({
      data: {
        profile_id: input.profileId,
        code: input.code,
        category: input.category,
        title: input.title,
        description: input.description,
        navigate_to: input.navigateTo,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async list(
    profileId: string,
    page: number,
    limit: number,
    category?: string,
  ) {
    const where: Prisma.NotificationWhereInput = {
      profile_id: profileId,
      is_deleted: false,
      ...(category ? { category } : {}),
    };

    const [items, total, unreadCount] = await Promise.all([
      this.prismaService.db.notification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaService.db.notification.count({ where }),
      this.prismaService.db.notification.count({
        where: { profile_id: profileId, is_deleted: false, is_read: false },
      }),
    ]);

    return paginated(
      items.map(toNotificationResponse),
      { page, limit, total },
      {
        unreadCount,
      },
    );
  }

  async markRead(id: string, profileId: string) {
    // Ownership-guarded and idempotent: only flips an unread row, so read_at is
    // never re-stamped on one already read. We then read back the current state
    // to return it (and to distinguish "not found" from "already read").
    await this.prismaService.db.notification.updateMany({
      where: { id, profile_id: profileId, is_deleted: false, is_read: false },
      data: { is_read: true, read_at: new Date() },
    });

    const notification = await this.prismaService.db.notification.findFirst({
      where: { id, profile_id: profileId, is_deleted: false },
    });
    if (!notification) throw new NotFoundException('Notification not found');

    return toNotificationResponse(notification);
  }

  async markAllRead(profileId: string) {
    await this.prismaService.db.notification.updateMany({
      where: { profile_id: profileId, is_read: false, is_deleted: false },
      data: { is_read: true, read_at: new Date() },
    });
  }
}
