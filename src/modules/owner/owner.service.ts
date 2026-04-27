import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { StaffService } from '../staff/staff.service.js';
import type { UpdateOwnerProfileDto } from './dto/update-owner-profile.dto.js';
import type { UpdateOwnerOrganizationDto } from './dto/update-owner-organization.dto.js';

@Injectable()
export class OwnerService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly staffService: StaffService,
  ) {}

  async getOwner(currentUserId: string, organizationId: string) {
    await this.staffService.assertOwner(currentUserId, organizationId);

    const staff = await this.prismaService.db.staff.findFirst({
      where: {
        user_id: currentUserId,
        organization_id: organizationId,
        is_deleted: false,
        role: { name: 'owner' },
      },
      include: {
        user: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            phone_number: true,
            profile: { select: { is_clinical: true, speciality: true } },
          },
        },
        role: { select: { id: true, name: true } },
        organization: {
          select: { id: true, name: true, specialities: true, status: true },
        },
      },
    });

    if (!staff) throw new NotFoundException('Owner staff record not found');

    const { user, role, organization, ...staffFields } = staff;
    const { profile, ...userFields } = user;

    return {
      user: userFields,
      profile: profile ?? { is_clinical: false, speciality: null },
      staff: {
        id: staffFields.id,
        job_title: staffFields.job_title,
        specialty: staffFields.specialty,
        role,
      },
      organization,
    };
  }

  async updateOwnerProfile(
    currentUserId: string,
    organizationId: string,
    dto: UpdateOwnerProfileDto,
  ) {
    await this.staffService.assertOwner(currentUserId, organizationId);

    const {
      first_name,
      last_name,
      phone_number,
      is_clinical,
      speciality,
      job_title,
      specialty,
    } = dto;

    await this.prismaService.db.$transaction(async (tx) => {
      if (
        first_name !== undefined ||
        last_name !== undefined ||
        phone_number !== undefined
      ) {
        await tx.user.update({
          where: { id: currentUserId },
          data: {
            ...(first_name !== undefined && { first_name }),
            ...(last_name !== undefined && { last_name }),
            ...(phone_number !== undefined && { phone_number }),
          },
        });
      }

      if (is_clinical !== undefined || speciality !== undefined) {
        await tx.profile.update({
          where: { user_id: currentUserId },
          data: {
            ...(is_clinical !== undefined && { is_clinical }),
            ...(speciality !== undefined && { speciality }),
          },
        });
      }

      if (job_title !== undefined || specialty !== undefined) {
        await tx.staff.updateMany({
          where: {
            user_id: currentUserId,
            organization_id: organizationId,
            is_deleted: false,
            role: { name: 'owner' },
          },
          data: {
            ...(job_title !== undefined && { job_title }),
            ...(specialty !== undefined && { specialty }),
          },
        });
      }
    });

    return this.getOwner(currentUserId, organizationId);
  }

  async updateOwnerOrganization(
    currentUserId: string,
    organizationId: string,
    dto: UpdateOwnerOrganizationDto,
  ) {
    await this.staffService.assertOwner(currentUserId, organizationId);

    const { name, specialities } = dto;

    await this.prismaService.db.organization.update({
      where: { id: organizationId },
      data: {
        ...(name !== undefined && { name }),
        ...(specialities !== undefined && { specialities }),
      },
    });

    return this.getOwner(currentUserId, organizationId);
  }
}
