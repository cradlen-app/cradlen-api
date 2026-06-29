import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { paginated } from '@common/utils/pagination.utils.js';
import type { AdminListQueryDto } from '../read/dto/admin-list-query.dto.js';
import type { AdminAuditLogResponseDto } from './dto/admin-audit-log-response.dto.js';

export interface RecordAuditInput {
  adminId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}

/**
 * Append-only audit trail for platform-admin writes. `record` accepts an
 * optional transaction client so the log row commits atomically with the
 * mutation it describes — callers that own a `$transaction` pass `tx`.
 */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prismaService: PrismaService) {}

  async record(
    input: RecordAuditInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prismaService.db;
    await db.adminAuditLog.create({
      data: {
        admin_id: input.adminId,
        action: input.action,
        target_type: input.targetType,
        target_id: input.targetId ?? null,
        before: input.before ?? Prisma.JsonNull,
        after: input.after ?? Prisma.JsonNull,
      },
    });
  }

  async list(query: AdminListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.AdminAuditLogWhereInput = query.search
      ? {
          OR: [
            { action: { contains: query.search, mode: 'insensitive' } },
            { target_type: { contains: query.search, mode: 'insensitive' } },
            { target_id: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [rows, total] = await Promise.all([
      this.prismaService.db.adminAuditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: { admin: { select: { email: true } } },
      }),
      this.prismaService.db.adminAuditLog.count({ where }),
    ]);

    return paginated(
      rows.map(
        (r): AdminAuditLogResponseDto => ({
          id: r.id,
          admin_id: r.admin_id,
          admin_email: r.admin.email,
          action: r.action,
          target_type: r.target_type,
          target_id: r.target_id,
          before: r.before,
          after: r.after,
          created_at: r.created_at,
        }),
      ),
      { page, limit, total },
    );
  }
}
