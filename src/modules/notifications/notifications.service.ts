import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { paginated } from '../../common/utils/pagination.utils.js';

interface CreateNotificationInput {
  userId: string;
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
        user_id: input.userId,
        category: input.category,
        title: input.title,
        description: input.description,
        navigate_to: input.navigateTo,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async list(userId: string, page: number, limit: number, category?: string) {
    const where: Prisma.NotificationWhereInput = {
      user_id: userId,
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
        where: { user_id: userId, is_deleted: false, is_read: false },
      }),
    ]);

    const result = paginated(items, { page, limit, total });
    (result.meta as unknown as Record<string, unknown>).unreadCount =
      unreadCount;
    return result;
  }

  async markRead(id: string, userId: string) {
    const notification = await this.prismaService.db.notification.findFirst({
      where: { id, user_id: userId, is_deleted: false },
    });
    if (!notification) throw new NotFoundException('Notification not found');

    return this.prismaService.db.notification.update({
      where: { id },
      data: { is_read: true, read_at: new Date() },
    });
  }

  async markAllRead(userId: string) {
    await this.prismaService.db.notification.updateMany({
      where: { user_id: userId, is_read: false, is_deleted: false },
      data: { is_read: true, read_at: new Date() },
    });
  }
}
