import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { OwnerService } from '../owner/owner.service.js';
import type { UpdateAccountProfileDto } from './dto/update-account-profile.dto.js';
import type { DeactivateAccountDto } from './dto/deactivate-account.dto.js';

@Injectable()
export class AccountService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly ownerService: OwnerService,
  ) {}

  async updateProfile(currentUserId: string, dto: UpdateAccountProfileDto) {
    const staff = await this.prismaService.db.staff.findFirst({
      where: {
        user_id: currentUserId,
        ...(dto.organization_id
          ? { organization_id: dto.organization_id }
          : {}),
        is_deleted: false,
        organization: { is_deleted: false, status: 'ACTIVE' },
        branch: { is_deleted: false, status: 'ACTIVE' },
        role: { name: { in: ['owner', 'doctor'] } },
      },
      include: {
        role: { select: { id: true, name: true } },
        user: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            phone_number: true,
          },
        },
        organization: {
          select: { id: true, name: true, specialities: true, status: true },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    if (!staff) throw new ForbiddenException('Settings access denied');

    if (staff.role.name === 'owner') {
      const { organization_id: _organizationId, ...ownerDto } = dto;
      return this.ownerService.updateOwnerProfile(
        currentUserId,
        staff.organization_id,
        ownerDto,
      );
    }

    if (dto.is_clinical === false) {
      throw new BadRequestException('Doctor profile must remain clinical');
    }

    await this.prismaService.db.$transaction(async (tx) => {
      if (
        dto.first_name !== undefined ||
        dto.last_name !== undefined ||
        dto.phone_number !== undefined
      ) {
        await tx.user.update({
          where: { id: currentUserId },
          data: {
            ...(dto.first_name !== undefined && { first_name: dto.first_name }),
            ...(dto.last_name !== undefined && { last_name: dto.last_name }),
            ...(dto.phone_number !== undefined && {
              phone_number: dto.phone_number,
            }),
          },
        });
      }

      if (
        dto.job_title !== undefined ||
        dto.specialty !== undefined ||
        dto.is_clinical !== undefined
      ) {
        await tx.staff.update({
          where: { id: staff.id },
          data: {
            is_clinical: true,
            ...(dto.job_title !== undefined && { job_title: dto.job_title }),
            ...(dto.specialty !== undefined && { specialty: dto.specialty }),
          },
        });
      }
    });

    return this.getStaffProfile(currentUserId, staff.organization_id, staff.id);
  }

  async deactivate(currentUserId: string, _dto: DeactivateAccountDto) {
    const now = new Date();

    await this.prismaService.db.$transaction(async (tx) => {
      const ownerStaff = await tx.staff.findMany({
        where: {
          user_id: currentUserId,
          is_deleted: false,
          role: { name: 'owner' },
          organization: { is_deleted: false, status: 'ACTIVE' },
        },
        select: { organization_id: true },
      });

      for (const owner of ownerStaff) {
        const otherOwners = await tx.staff.count({
          where: {
            organization_id: owner.organization_id,
            user_id: { not: currentUserId },
            is_deleted: false,
            role: { name: 'owner' },
          },
        });

        if (otherOwners === 0) {
          await this.cascadeDisableOrganization(tx, owner.organization_id, now);
        }
      }

      await tx.staff.updateMany({
        where: { user_id: currentUserId, is_deleted: false },
        data: { is_deleted: true, deleted_at: now },
      });
      await tx.profile.updateMany({
        where: { user_id: currentUserId, is_deleted: false },
        data: { is_deleted: true, deleted_at: now },
      });
      await tx.refreshToken.updateMany({
        where: { user_id: currentUserId, is_revoked: false },
        data: { is_revoked: true, revoked_at: now },
      });
      await tx.user.update({
        where: { id: currentUserId },
        data: { is_active: false, is_deleted: true, deleted_at: now },
      });
    });

    return { user_id: currentUserId, is_active: false };
  }

  private async getStaffProfile(
    currentUserId: string,
    organizationId: string,
    staffId: string,
  ) {
    const staff = await this.prismaService.db.staff.findFirstOrThrow({
      where: {
        id: staffId,
        user_id: currentUserId,
        organization_id: organizationId,
        is_deleted: false,
      },
      include: {
        user: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            phone_number: true,
          },
        },
        role: { select: { id: true, name: true } },
        organization: {
          select: { id: true, name: true, specialities: true, status: true },
        },
      },
    });

    const { user, role, organization, ...staffFields } = staff;
    return {
      user,
      staff: {
        id: staffFields.id,
        is_clinical: staffFields.is_clinical,
        job_title: staffFields.job_title,
        specialty: staffFields.specialty,
        role,
      },
      organization,
    };
  }

  private async cascadeDisableOrganization(
    tx: Prisma.TransactionClient,
    organizationId: string,
    now: Date,
  ) {
    await tx.organization.update({
      where: { id: organizationId },
      data: { status: 'INACTIVE', is_deleted: true, deleted_at: now },
    });
    await tx.branch.updateMany({
      where: { organization_id: organizationId, is_deleted: false },
      data: { status: 'INACTIVE', is_deleted: true, deleted_at: now },
    });
    await tx.staff.updateMany({
      where: { organization_id: organizationId, is_deleted: false },
      data: { is_deleted: true, deleted_at: now },
    });
    await tx.subscription.updateMany({
      where: { organization_id: organizationId, is_deleted: false },
      data: { status: 'CANCELLED', is_deleted: true, deleted_at: now },
    });
    await tx.staffInvitation.updateMany({
      where: {
        organization_id: organizationId,
        is_deleted: false,
        status: 'PENDING',
      },
      data: { status: 'CANCELLED', is_deleted: true, deleted_at: now },
    });
  }
}
