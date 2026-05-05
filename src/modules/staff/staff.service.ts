import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import type {
  BranchScheduleDto,
  CreateStaffDto,
  UpdateStaffDto,
} from './dto/staff.dto.js';
import { persistSchedules } from './schedule.helpers.js';

const STAFF_EMAIL_DOMAIN = 'cradlen.com';

@Injectable()
export class StaffService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async createStaff(
    profileId: string,
    organizationId: string,
    dto: CreateStaffDto,
  ) {
    await this.authorizationService.assertCanManageStaff(
      profileId,
      organizationId,
    );
    await this.subscriptionsService.assertStaffLimit(organizationId);

    const uniqueRoleIds = [...new Set(dto.role_ids)];
    const uniqueBranchIds = [...new Set(dto.branch_ids)];

    await this.assertBranchesInOrganization(organizationId, uniqueBranchIds);
    await this.assertRolesExist(uniqueRoleIds);

    if (dto.schedule?.length) {
      const invalidIds = dto.schedule
        .map((s) => s.branch_id)
        .filter((id) => !uniqueBranchIds.includes(id));
      if (invalidIds.length) {
        throw new BadRequestException(
          `Schedule branch_ids not in branch_ids: ${invalidIds.join(', ')}`,
        );
      }
      this.assertShiftTimes(dto.schedule);
    }

    const existingByPhone = await this.prismaService.db.user.findFirst({
      where: { phone_number: dto.phone_number, is_deleted: false },
    });
    if (existingByPhone) {
      throw new ConflictException(
        'A user with this phone number already exists',
      );
    }

    const email = await this.generateUniqueEmail(dto.first_name, dto.last_name);

    return this.prismaService.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          first_name: dto.first_name,
          last_name: dto.last_name,
          email,
          phone_number: dto.phone_number,
          password_hashed: await bcrypt.hash(dto.password, 12),
          registration_status: 'ACTIVE',
          onboarding_completed: true,
          verified_at: null,
        },
      });

      const profile = await tx.profile.create({
        data: {
          user_id: user.id,
          organization_id: organizationId,
          job_title: dto.job_title ?? null,
          specialty: dto.specialty ?? null,
          is_clinical: dto.is_clinical ?? false,
        },
      });

      await Promise.all([
        ...uniqueRoleIds.map((role_id) =>
          tx.profileRole.create({ data: { profile_id: profile.id, role_id } }),
        ),
        ...uniqueBranchIds.map((branch_id) =>
          tx.profileBranch.create({
            data: {
              profile_id: profile.id,
              branch_id,
              organization_id: organizationId,
            },
          }),
        ),
      ]);

      if (dto.schedule?.length) {
        await this.createSchedules(tx, profile.id, dto.schedule);
      }

      return {
        user_id: user.id,
        profile_id: profile.id,
        organization_id: organizationId,
        generated_email: email,
      };
    });
  }

  async listStaff(
    profileId: string,
    organizationId: string,
    branchId?: string,
  ) {
    await this.authorizationService.assertCanManageStaff(
      profileId,
      organizationId,
    );

    const where: Prisma.ProfileWhereInput = {
      organization_id: organizationId,
      is_deleted: false,
      is_active: true,
    };
    if (branchId) {
      where.branches = { some: { branch_id: branchId } };
    }

    const profiles = await this.prismaService.db.profile.findMany({
      where,
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
        roles: { include: { role: true } },
        branches: {
          where: { branch: { is_deleted: false } },
          include: { branch: true },
        },
        workingSchedules: {
          include: {
            days: {
              include: { shifts: true },
            },
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    return profiles.map((p) => this.toStaffResponse(p));
  }

  async updateStaff(
    callerProfileId: string,
    organizationId: string,
    staffProfileId: string,
    dto: UpdateStaffDto,
  ) {
    await this.authorizationService.assertCanManageStaff(
      callerProfileId,
      organizationId,
    );

    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        id: staffProfileId,
        organization_id: organizationId,
        is_deleted: false,
      },
      include: { user: true },
    });
    if (!profile) throw new NotFoundException('Staff member not found');

    if (
      dto.phone_number !== undefined &&
      dto.phone_number !== profile.user.phone_number
    ) {
      const existingByPhone = await this.prismaService.db.user.findFirst({
        where: {
          phone_number: dto.phone_number,
          is_deleted: false,
          id: { not: profile.user_id },
        },
      });
      if (existingByPhone) {
        throw new ConflictException(
          'A user with this phone number already exists',
        );
      }
    }

    let uniqueRoleIds: string[] | undefined;
    let uniqueBranchIds: string[] | undefined;

    if (dto.role_ids) {
      uniqueRoleIds = [...new Set(dto.role_ids)];
      await this.assertRolesExist(uniqueRoleIds);
    }

    if (dto.branch_ids) {
      uniqueBranchIds = [...new Set(dto.branch_ids)];
      await this.assertBranchesInOrganization(organizationId, uniqueBranchIds);
    }

    if (dto.schedule?.length) {
      const effectiveBranchIds =
        uniqueBranchIds ??
        (
          await this.prismaService.db.profileBranch.findMany({
            where: { profile_id: staffProfileId },
            select: { branch_id: true },
          })
        ).map((b) => b.branch_id);

      const invalidIds = dto.schedule
        .map((s) => s.branch_id)
        .filter((id) => !effectiveBranchIds.includes(id));
      if (invalidIds.length) {
        throw new BadRequestException(
          `Schedule branch_ids not in branch_ids: ${invalidIds.join(', ')}`,
        );
      }
      this.assertShiftTimes(dto.schedule);
    }

    return this.prismaService.db.$transaction(async (tx) => {
      if (
        dto.first_name !== undefined ||
        dto.last_name !== undefined ||
        dto.phone_number !== undefined
      ) {
        await tx.user.update({
          where: { id: profile.user_id },
          data: {
            ...(dto.first_name !== undefined && { first_name: dto.first_name }),
            ...(dto.last_name !== undefined && { last_name: dto.last_name }),
            ...(dto.phone_number !== undefined && {
              phone_number: dto.phone_number,
            }),
          },
        });
      }

      await tx.profile.update({
        where: { id: staffProfileId },
        data: {
          ...(dto.job_title !== undefined && { job_title: dto.job_title }),
          ...(dto.specialty !== undefined && { specialty: dto.specialty }),
          ...(dto.is_clinical !== undefined && {
            is_clinical: dto.is_clinical,
          }),
        },
      });

      if (uniqueRoleIds) {
        await tx.profileRole.deleteMany({
          where: { profile_id: staffProfileId },
        });
        await Promise.all(
          uniqueRoleIds.map((role_id) =>
            tx.profileRole.create({
              data: { profile_id: staffProfileId, role_id },
            }),
          ),
        );
      }

      if (uniqueBranchIds) {
        await tx.profileBranch.deleteMany({
          where: { profile_id: staffProfileId },
        });
        await Promise.all(
          uniqueBranchIds.map((branch_id) =>
            tx.profileBranch.create({
              data: {
                profile_id: staffProfileId,
                branch_id,
                organization_id: organizationId,
              },
            }),
          ),
        );
      }

      if (dto.schedule !== undefined) {
        await tx.workingSchedule.deleteMany({
          where: { profile_id: staffProfileId },
        });
        if (dto.schedule.length > 0) {
          await this.createSchedules(tx, staffProfileId, dto.schedule);
        }
      }

      const updated = await tx.profile.findFirst({
        where: { id: staffProfileId },
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
          roles: { include: { role: true } },
          branches: {
            where: { branch: { is_deleted: false } },
            include: { branch: true },
          },
          workingSchedules: {
            include: { days: { include: { shifts: true } } },
          },
        },
      });

      return this.toStaffResponse(updated!);
    });
  }

  async deleteStaff(
    callerProfileId: string,
    organizationId: string,
    staffProfileId: string,
  ) {
    await this.authorizationService.assertCanManageStaff(
      callerProfileId,
      organizationId,
    );

    if (staffProfileId === callerProfileId) {
      throw new BadRequestException('Cannot delete your own staff profile');
    }

    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        id: staffProfileId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!profile) throw new NotFoundException('Staff member not found');

    await this.prismaService.db.profile.update({
      where: { id: staffProfileId },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  private toStaffResponse(p: {
    id: string;
    user_id: string;
    job_title: string | null;
    specialty: string | null;
    is_clinical: boolean;
    user: {
      id: string;
      first_name: string;
      last_name: string;
      email: string | null;
      phone_number: string | null;
    };
    roles: { role: { id: string; name: string } }[];
    branches: {
      branch: {
        id: string;
        name: string;
        city: string;
        governorate: string;
      };
    }[];
    workingSchedules: {
      branch_id: string;
      days: {
        day_of_week: string;
        shifts: { start_time: string; end_time: string }[];
      }[];
    }[];
  }) {
    return {
      profile_id: p.id,
      user_id: p.user.id,
      first_name: p.user.first_name,
      last_name: p.user.last_name,
      email: p.user.email,
      phone_number: p.user.phone_number,
      job_title: p.job_title,
      specialty: p.specialty,
      is_clinical: p.is_clinical,
      roles: p.roles.map((r) => ({ id: r.role.id, name: r.role.name })),
      branches: p.branches.map((b) => ({
        id: b.branch.id,
        name: b.branch.name,
        city: b.branch.city,
        governorate: b.branch.governorate,
      })),
      schedule: p.workingSchedules.map((ws) => ({
        branch_id: ws.branch_id,
        days: ws.days.map((d) => ({
          day_of_week: d.day_of_week,
          shifts: d.shifts.map((s) => ({
            start_time: s.start_time,
            end_time: s.end_time,
          })),
        })),
      })),
    };
  }

  private async createSchedules(
    tx: Prisma.TransactionClient,
    profileId: string,
    schedule: BranchScheduleDto[],
  ) {
    await persistSchedules(tx, profileId, schedule);
  }

  private async generateUniqueEmail(
    firstName: string,
    lastName: string,
  ): Promise<string> {
    const slug = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '');

    const base = `${slug(firstName)}-${slug(lastName)}`;

    for (let attempt = 0; attempt < 10; attempt++) {
      const suffix = Math.floor(1000 + Math.random() * 9000);
      const email = `${base}${suffix}@${STAFF_EMAIL_DOMAIN}`;
      const exists = await this.prismaService.db.user.findFirst({
        where: { email },
      });
      if (!exists) return email;
    }

    return `${base}${Date.now()}@${STAFF_EMAIL_DOMAIN}`;
  }

  private async assertBranchesInOrganization(
    organizationId: string,
    branchIds: string[],
  ) {
    const count = await this.prismaService.db.branch.count({
      where: {
        id: { in: branchIds },
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (count !== branchIds.length) {
      throw new NotFoundException('One or more branches were not found');
    }
  }

  private assertShiftTimes(schedule: BranchScheduleDto[]) {
    for (const branch of schedule) {
      for (const day of branch.days) {
        for (const shift of day.shifts) {
          if (shift.end_time <= shift.start_time) {
            throw new BadRequestException(
              `Shift end_time must be after start_time (${shift.start_time} – ${shift.end_time})`,
            );
          }
        }
      }
    }
  }

  private async assertRolesExist(roleIds: string[]) {
    const count = await this.prismaService.db.role.count({
      where: { id: { in: roleIds } },
    });
    if (count !== roleIds.length) {
      throw new NotFoundException('One or more roles were not found');
    }
  }
}
