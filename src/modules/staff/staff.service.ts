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
import type { BranchScheduleDto, CreateStaffDto } from './dto/staff.dto.js';

const STAFF_EMAIL_DOMAIN = 'cradlen.com';

@Injectable()
export class StaffService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async createStaff(profileId: string, accountId: string, dto: CreateStaffDto) {
    await this.authorizationService.assertCanManageStaff(profileId, accountId);
    await this.assertBranchesInAccount(accountId, dto.branch_ids);

    if (dto.schedule?.length) {
      const invalidIds = dto.schedule
        .map((s) => s.branch_id)
        .filter((id) => !dto.branch_ids.includes(id));
      if (invalidIds.length) {
        throw new BadRequestException(
          `Schedule branch_ids not in branch_ids: ${invalidIds.join(', ')}`,
        );
      }
    }

    const existingByPhone = await this.prismaService.db.user.findFirst({
      where: { phone_number: dto.phone_number, is_deleted: false },
    });
    if (existingByPhone) {
      throw new ConflictException('A user with this phone number already exists');
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
          account_id: accountId,
          job_title: dto.job_title ?? null,
          specialty: dto.specialty ?? null,
          is_clinical: dto.is_clinical ?? false,
        },
      });

      await Promise.all([
        ...dto.role_ids.map((role_id) =>
          tx.profileRole.create({ data: { profile_id: profile.id, role_id } }),
        ),
        ...dto.branch_ids.map((branch_id) =>
          tx.profileBranch.create({
            data: { profile_id: profile.id, branch_id, account_id: accountId },
          }),
        ),
      ]);

      if (dto.schedule?.length) {
        await this.createSchedules(tx, profile.id, dto.schedule);
      }

      return {
        user_id: user.id,
        profile_id: profile.id,
        account_id: accountId,
        generated_email: email,
      };
    });
  }

  async listStaff(profileId: string, accountId: string) {
    await this.authorizationService.assertCanManageStaff(profileId, accountId);

    const profiles = await this.prismaService.db.profile.findMany({
      where: { account_id: accountId, is_deleted: false, is_active: true },
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

    return profiles.map((p) => ({
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
    }));
  }

  private async createSchedules(
    tx: Prisma.TransactionClient,
    profileId: string,
    schedule: BranchScheduleDto[],
  ) {
    for (const branchSchedule of schedule) {
      const ws = await tx.workingSchedule.create({
        data: { profile_id: profileId, branch_id: branchSchedule.branch_id },
      });

      for (const day of branchSchedule.days) {
        const wd = await tx.workingDay.create({
          data: { schedule_id: ws.id, day_of_week: day.day_of_week },
        });

        await tx.workingShift.createMany({
          data: day.shifts.map((s) => ({
            day_id: wd.id,
            start_time: s.start_time,
            end_time: s.end_time,
          })),
        });
      }
    }
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

  private async assertBranchesInAccount(
    accountId: string,
    branchIds: string[],
  ) {
    const count = await this.prismaService.db.branch.count({
      where: {
        id: { in: branchIds },
        account_id: accountId,
        is_deleted: false,
      },
    });
    if (count !== new Set(branchIds).size) {
      throw new NotFoundException('One or more branches were not found');
    }
  }
}
