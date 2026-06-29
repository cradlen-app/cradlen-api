import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { AdminVerificationService } from '../auth/admin-verification.service.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';
import type { AdminListQueryDto } from '../read/dto/admin-list-query.dto.js';
import type { CreateAdminDto } from './dto/create-admin.dto.js';
import type {
  AdminAccountStatus,
  AdminResponseDto,
} from './dto/admin-response.dto.js';

type AdminRow = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  password_hashed: string | null;
  created_at: Date;
};

const SELECT = {
  id: true,
  email: true,
  full_name: true,
  is_active: true,
  password_hashed: true,
  created_at: true,
} as const;

/**
 * In-app platform-admin management. Flat tier — any active admin manages others.
 * A created admin has no password and is PENDING until they complete the emailed
 * set-password invite. `password_hashed` is read only to derive `status`; it is
 * never returned.
 */
@Injectable()
export class AdminsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly verification: AdminVerificationService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PlatformAdminWhereInput = {
      is_deleted: false,
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { full_name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prismaService.db.platformAdmin.findMany({
        where,
        select: SELECT,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prismaService.db.platformAdmin.count({ where }),
    ]);

    return paginated(
      rows.map((r) => this.toDto(r)),
      { page, limit, total },
    );
  }

  /** Creates a passwordless admin and emails the set-password invite. */
  async create(
    actorId: string,
    dto: CreateAdminDto,
  ): Promise<AdminResponseDto> {
    // A duplicate email surfaces as Prisma P2002 → 409 via the global filter.
    const admin = await this.prismaService.db.platformAdmin.create({
      data: { email: dto.email, full_name: dto.full_name },
      select: SELECT,
    });

    await this.verification.sendSetPasswordInvite(admin.id, admin.email);
    await this.audit.record({
      adminId: actorId,
      action: 'admin.create',
      targetType: 'platform_admin',
      targetId: admin.id,
      after: { email: admin.email, full_name: admin.full_name },
    });
    return this.toDto(admin);
  }

  async disable(actorId: string, id: string): Promise<AdminResponseDto> {
    if (id === actorId) {
      throw new BadRequestException('You cannot disable your own account');
    }
    const admin = await this.requireAdmin(id);
    if (admin.is_active) {
      const activeCount = await this.prismaService.db.platformAdmin.count({
        where: { is_active: true, is_deleted: false },
      });
      if (activeCount <= 1) {
        throw new BadRequestException('Cannot disable the last active admin');
      }
    }
    return this.setActive(actorId, admin, false, 'admin.disable');
  }

  async enable(actorId: string, id: string): Promise<AdminResponseDto> {
    const admin = await this.requireAdmin(id);
    return this.setActive(actorId, admin, true, 'admin.enable');
  }

  /** Re-sends the set-password invite for an admin who hasn't set one yet. */
  async resendInvite(actorId: string, id: string): Promise<AdminResponseDto> {
    const admin = await this.requireAdmin(id);
    if (admin.password_hashed) {
      throw new BadRequestException('This admin has already set a password');
    }
    await this.verification.sendSetPasswordInvite(admin.id, admin.email);
    await this.audit.record({
      adminId: actorId,
      action: 'admin.invite_resend',
      targetType: 'platform_admin',
      targetId: admin.id,
    });
    return this.toDto(admin);
  }

  private async setActive(
    actorId: string,
    admin: AdminRow,
    isActive: boolean,
    action: string,
  ): Promise<AdminResponseDto> {
    const updated = await this.prismaService.db.platformAdmin.update({
      where: { id: admin.id },
      data: { is_active: isActive },
      select: SELECT,
    });
    await this.audit.record({
      adminId: actorId,
      action,
      targetType: 'platform_admin',
      targetId: admin.id,
      before: { is_active: admin.is_active },
      after: { is_active: isActive },
    });
    return this.toDto(updated);
  }

  private async requireAdmin(id: string): Promise<AdminRow> {
    const admin = await this.prismaService.db.platformAdmin.findFirst({
      where: { id, is_deleted: false },
      select: SELECT,
    });
    if (!admin) throw new NotFoundException('Admin not found');
    return admin;
  }

  private toDto(row: AdminRow): AdminResponseDto {
    let status: AdminAccountStatus;
    if (!row.is_active) status = 'DISABLED';
    else if (!row.password_hashed) status = 'PENDING';
    else status = 'ACTIVE';
    return {
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      status,
      created_at: row.created_at,
    };
  }
}
