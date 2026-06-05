import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { paginated } from '@common/utils/pagination.utils.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { toPatientNotificationResponse } from './patient-notifications.mapper.js';

interface CreatePatientNotificationInput {
  patientId: string;
  organizationId: string;
  code: string;
  category: string;
  title: string;
  description: string;
  navigateTo?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class PatientNotificationsService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(input: CreatePatientNotificationInput) {
    return this.prismaService.db.patientNotification.create({
      data: {
        patient_id: input.patientId,
        organization_id: input.organizationId,
        code: input.code,
        category: input.category,
        title: input.title,
        description: input.description,
        navigate_to: input.navigateTo,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /**
   * Lists notifications for every patient the caller may access (their own
   * record, or — for a guardian — all linked patients), newest first.
   */
  async list(
    ctx: PatientAuthContext,
    page: number,
    limit: number,
    category?: string,
  ) {
    const targetIds = ctx.accessiblePatientIds;
    if (targetIds.length === 0) {
      return paginated([], { page, limit, total: 0 }, { unreadCount: 0 });
    }

    const where: Prisma.PatientNotificationWhereInput = {
      patient_id: { in: targetIds },
      is_deleted: false,
      ...(category ? { category } : {}),
    };

    const [items, total, unreadCount] = await Promise.all([
      this.prismaService.db.patientNotification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaService.db.patientNotification.count({ where }),
      this.prismaService.db.patientNotification.count({
        where: {
          patient_id: { in: targetIds },
          is_deleted: false,
          is_read: false,
        },
      }),
    ]);

    return paginated(
      items.map(toPatientNotificationResponse),
      { page, limit, total },
      { unreadCount },
    );
  }

  async markRead(id: string, ctx: PatientAuthContext) {
    const targetIds = ctx.accessiblePatientIds;
    // Ownership-guarded and idempotent: only flips an unread row owned by an
    // accessible patient, so read_at is never re-stamped on one already read.
    await this.prismaService.db.patientNotification.updateMany({
      where: {
        id,
        patient_id: { in: targetIds },
        is_deleted: false,
        is_read: false,
      },
      data: { is_read: true, read_at: new Date() },
    });

    const notification =
      await this.prismaService.db.patientNotification.findFirst({
        where: { id, patient_id: { in: targetIds }, is_deleted: false },
      });
    if (!notification) throw new NotFoundException('Notification not found');

    return toPatientNotificationResponse(notification);
  }

  async markAllRead(ctx: PatientAuthContext) {
    await this.prismaService.db.patientNotification.updateMany({
      where: {
        patient_id: { in: ctx.accessiblePatientIds },
        is_read: false,
        is_deleted: false,
      },
      data: { is_read: true, read_at: new Date() },
    });
  }
}
