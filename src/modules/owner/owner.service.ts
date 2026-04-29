import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { StaffService } from '../staff/staff.service.js';
import type { AuthConfig } from '../../config/auth.config.js';
import type { CreateOwnerOrganizationDto } from './dto/create-owner-organization.dto.js';
import type { UpdateOwnerProfileDto } from './dto/update-owner-profile.dto.js';
import type { UpdateOwnerOrganizationDto } from './dto/update-owner-organization.dto.js';
import type { CreateOwnerBranchDto } from './dto/create-owner-branch.dto.js';
import type { UpdateOwnerBranchDto } from './dto/update-owner-branch.dto.js';

@Injectable()
export class OwnerService {
  private readonly authConfig: AuthConfig;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly staffService: StaffService,
    private readonly configService: ConfigService,
  ) {
    const config = this.configService.get<AuthConfig>('auth');
    if (!config) throw new Error('Auth configuration not loaded');
    this.authConfig = config;
  }

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

    if (!ownerStaff)
      throw new NotFoundException('Owner staff record not found');

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
      throw new BadRequestException('specialty is required for clinical users');
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

    const { name, specialities, status } = dto;

    await this.prismaService.db.organization.update({
      where: { id: organizationId },
      data: {
        ...(name !== undefined && { name }),
        ...(specialities !== undefined && { specialities }),
        ...(status !== undefined && { status }),
      },
    });

    return this.getOwner(currentUserId, organizationId);
  }

  async createOrganization(
    currentUserId: string,
    dto: CreateOwnerOrganizationDto,
  ) {
    const activeOwnership = await this.prismaService.db.staff.findFirst({
      where: {
        user_id: currentUserId,
        is_deleted: false,
        role: { name: 'owner' },
        organization: { status: 'ACTIVE', is_deleted: false },
      },
      select: { id: true },
    });
    if (activeOwnership) {
      throw new ConflictException('User already owns an active organization');
    }

    const [ownerRole, freePlan] = await Promise.all([
      this.prismaService.db.role.findFirst({ where: { name: 'owner' } }),
      this.prismaService.db.subscriptionPlan.findFirst({
        where: { plan: 'free_trial' },
      }),
    ]);

    if (!ownerRole)
      throw new InternalServerErrorException('Owner role not seeded');
    if (!freePlan)
      throw new InternalServerErrorException('Free trial plan not seeded');
    if (dto.is_clinical && !dto.specialty) {
      throw new BadRequestException('specialty is required for clinical users');
    }

    const doctorRole = dto.is_clinical
      ? await this.prismaService.db.role.findFirst({
          where: { name: 'doctor' },
        })
      : null;

    if (dto.is_clinical && !doctorRole) {
      throw new InternalServerErrorException('Doctor role not seeded');
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + this.authConfig.freeTrialDays);

    return this.prismaService.db.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: dto.name,
          specialities: dto.specialities ?? [],
          status: 'ACTIVE',
        },
      });

      const branch = await tx.branch.create({
        data: {
          organization_id: organization.id,
          address: dto.address,
          city: dto.city,
          governorate: dto.governorate,
          country: dto.country,
          is_main: true,
          status: 'ACTIVE',
        },
      });

      await tx.staff.create({
        data: {
          user_id: currentUserId,
          organization_id: organization.id,
          branch_id: branch.id,
          role_id: ownerRole.id,
          is_clinical: false,
          ...(!dto.is_clinical &&
            dto.job_title !== undefined && { job_title: dto.job_title }),
        },
      });

      if (dto.is_clinical && doctorRole) {
        await tx.staff.create({
          data: {
            user_id: currentUserId,
            organization_id: organization.id,
            branch_id: branch.id,
            role_id: doctorRole.id,
            is_clinical: true,
            specialty: dto.specialty,
            ...(dto.job_title !== undefined && { job_title: dto.job_title }),
          },
        });
      }

      await tx.subscription.create({
        data: {
          organization_id: organization.id,
          subscription_plan_id: freePlan.id,
          trial_ends_at: trialEndsAt,
        },
      });

      return { organization, branch };
    });
  }

  async deleteOrganization(currentUserId: string, organizationId: string) {
    await this.staffService.assertOwner(currentUserId, organizationId);
    const now = new Date();

    await this.prismaService.db.$transaction((tx) =>
      this.cascadeDisableOrganization(tx, organizationId, now),
    );

    return { organization_id: organizationId, status: 'INACTIVE' };
  }

  async createBranch(currentUserId: string, dto: CreateOwnerBranchDto) {
    await this.staffService.assertOwner(currentUserId, dto.organization_id);

    return this.prismaService.db.$transaction(async (tx) => {
      if (dto.is_main) {
        await tx.branch.updateMany({
          where: {
            organization_id: dto.organization_id,
            is_deleted: false,
            status: 'ACTIVE',
            is_main: true,
          },
          data: { is_main: false },
        });
      }

      const branch = await tx.branch.create({
        data: {
          organization_id: dto.organization_id,
          address: dto.address,
          city: dto.city,
          governorate: dto.governorate,
          country: dto.country,
          is_main: dto.is_main ?? false,
          status: 'ACTIVE',
        },
      });

      return { branch };
    });
  }

  async updateBranch(
    currentUserId: string,
    organizationId: string,
    branchId: string,
    dto: UpdateOwnerBranchDto,
  ) {
    await this.staffService.assertOwner(currentUserId, organizationId);

    const branch = await this.prismaService.db.branch.findFirst({
      where: {
        id: branchId,
        organization_id: organizationId,
        is_deleted: false,
        status: 'ACTIVE',
      },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    if (branch.is_main && dto.is_main === false) {
      throw new BadRequestException('At least one active branch must be main');
    }

    return this.prismaService.db.$transaction(async (tx) => {
      if (dto.is_main === true) {
        await tx.branch.updateMany({
          where: {
            organization_id: organizationId,
            id: { not: branchId },
            is_deleted: false,
            status: 'ACTIVE',
            is_main: true,
          },
          data: { is_main: false },
        });
      }

      const updated = await tx.branch.update({
        where: { id: branchId },
        data: {
          ...(dto.address !== undefined && { address: dto.address }),
          ...(dto.city !== undefined && { city: dto.city }),
          ...(dto.governorate !== undefined && {
            governorate: dto.governorate,
          }),
          ...(dto.country !== undefined && { country: dto.country }),
          ...(dto.is_main !== undefined && { is_main: dto.is_main }),
        },
      });

      return { branch: updated };
    });
  }

  async deleteBranch(
    currentUserId: string,
    organizationId: string,
    branchId: string,
  ) {
    await this.staffService.assertOwner(currentUserId, organizationId);

    const branch = await this.prismaService.db.branch.findFirst({
      where: {
        id: branchId,
        organization_id: organizationId,
        is_deleted: false,
        status: 'ACTIVE',
      },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    const activeBranches = await this.prismaService.db.branch.findMany({
      where: {
        organization_id: organizationId,
        is_deleted: false,
        status: 'ACTIVE',
      },
      orderBy: { created_at: 'asc' },
    });

    if (activeBranches.length <= 1) {
      throw new BadRequestException('Cannot delete the only active branch');
    }

    const replacement = activeBranches.find((item) => item.id !== branchId);
    if (branch.is_main && !replacement) {
      throw new BadRequestException('Another active branch is required');
    }

    const now = new Date();
    await this.prismaService.db.$transaction(async (tx) => {
      if (branch.is_main && replacement) {
        await tx.branch.update({
          where: { id: replacement.id },
          data: { is_main: true },
        });
      }

      await tx.branch.update({
        where: { id: branchId },
        data: {
          status: 'INACTIVE',
          is_deleted: true,
          deleted_at: now,
          is_main: false,
        },
      });
      await tx.staff.updateMany({
        where: {
          organization_id: organizationId,
          branch_id: branchId,
          is_deleted: false,
        },
        data: { is_deleted: true, deleted_at: now },
      });
    });

    return { branch_id: branchId, status: 'INACTIVE' };
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
