import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
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
          },
        },
        role: { select: { id: true, name: true } },
        organization: {
          select: { id: true, name: true, specialities: true, status: true },
        },
      },
    });

    if (!staff) throw new NotFoundException('Owner staff record not found');

    const doctorStaff = await this.prismaService.db.staff.findFirst({
      where: {
        user_id: currentUserId,
        organization_id: organizationId,
        is_deleted: false,
        role: { name: 'doctor' },
      },
      select: {
        is_clinical: true,
        job_title: true,
        specialty: true,
      },
    });

    const { user, role, organization, ...staffFields } = staff;

    return {
      user,
      staff: {
        id: staffFields.id,
        is_clinical: !!doctorStaff || staffFields.is_clinical,
        job_title: doctorStaff?.job_title ?? staffFields.job_title,
        specialty: doctorStaff?.specialty ?? staffFields.specialty,
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
      job_title,
      specialty,
    } = dto;

    const [ownerStaff, activeDoctorStaff] = await Promise.all([
      this.prismaService.db.staff.findFirst({
        where: {
          user_id: currentUserId,
          organization_id: organizationId,
          is_deleted: false,
          role: { name: 'owner' },
        },
      }),
      this.prismaService.db.staff.findFirst({
        where: {
          user_id: currentUserId,
          organization_id: organizationId,
          is_deleted: false,
          role: { name: 'doctor' },
        },
      }),
    ]);

    if (!ownerStaff) throw new NotFoundException('Owner staff record not found');

    const shouldEnableClinical = is_clinical === true;
    const shouldDisableClinical = is_clinical === false;
    const shouldUpdateDoctorFields =
      !shouldDisableClinical &&
      (shouldEnableClinical ||
        (!!activeDoctorStaff &&
          (job_title !== undefined || specialty !== undefined)));

    if (
      shouldEnableClinical &&
      specialty === undefined &&
      !activeDoctorStaff?.specialty
    ) {
      throw new BadRequestException(
        'specialty is required for clinical users',
      );
    }

    const doctorRole = shouldEnableClinical
      ? await this.prismaService.db.role.findFirst({
          where: { name: 'doctor' },
        })
      : null;

    if (shouldEnableClinical && !doctorRole) {
      throw new InternalServerErrorException('Doctor role not seeded');
    }

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

      if (shouldDisableClinical) {
        await tx.staff.updateMany({
          where: {
            user_id: currentUserId,
            organization_id: organizationId,
            is_deleted: false,
            role: { name: 'doctor' },
          },
          data: {
            is_deleted: true,
            deleted_at: new Date(),
          },
        });
      }

      if (shouldUpdateDoctorFields) {
        if (activeDoctorStaff) {
          await tx.staff.update({
            where: { id: activeDoctorStaff.id },
            data: {
              is_clinical: true,
              ...(job_title !== undefined && { job_title }),
              ...(specialty !== undefined && { specialty }),
            },
          });
          return;
        }

        if (!doctorRole) {
          throw new InternalServerErrorException('Doctor role not seeded');
        }

        const existingDoctorStaff = await tx.staff.findFirst({
          where: {
            user_id: currentUserId,
            organization_id: organizationId,
            branch_id: ownerStaff.branch_id,
            role_id: doctorRole.id,
          },
        });

        if (existingDoctorStaff) {
          await tx.staff.update({
            where: { id: existingDoctorStaff.id },
            data: {
              is_deleted: false,
              deleted_at: null,
              is_clinical: true,
              ...(job_title !== undefined && { job_title }),
              ...(specialty !== undefined && { specialty }),
            },
          });
        } else {
          await tx.staff.create({
            data: {
              user_id: currentUserId,
              organization_id: organizationId,
              branch_id: ownerStaff.branch_id,
              role_id: doctorRole.id,
              is_clinical: true,
              job_title,
              specialty,
            },
          });
        }
      } else if (
        !activeDoctorStaff &&
        !shouldDisableClinical &&
        job_title !== undefined
      ) {
        await tx.staff.update({
          where: { id: ownerStaff.id },
          data: { job_title },
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
