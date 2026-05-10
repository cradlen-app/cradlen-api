import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  EngagementType,
  ExecutiveTitle,
  JobFunction,
  Prisma,
  Specialty,
} from '@prisma/client';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { paginated } from '../../common/utils/pagination.utils.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import {
  STAFF_ROLE_NAMES,
  type BranchScheduleDto,
  type CreateStaffDto,
  type UpdateStaffDto,
} from './dto/staff.dto.js';
import { persistSchedules } from './schedule.helpers.js';

const STAFF_EMAIL_DOMAIN = 'cradlen.com';

interface ResolvedAccess {
  jobFunctions: JobFunction[];
  specialties: Specialty[];
}

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
    const uniqueRoleIds = [...new Set(dto.role_ids)];
    const uniqueBranchIds = [...new Set(dto.branch_ids)];
    const jobFunctionCodes = [...new Set(dto.job_function_codes ?? [])];
    const specialtyCodes = [...new Set(dto.specialty_codes ?? [])];

    await this.authorizationService.assertCanManageStaffOnBranches(
      profileId,
      organizationId,
      uniqueBranchIds,
    );
    await this.authorizationService.assertNoPrivilegedRoleAssignment(
      profileId,
      organizationId,
      uniqueRoleIds,
    );
    await this.subscriptionsService.assertStaffLimit(organizationId);

    await this.assertBranchesInOrganization(organizationId, uniqueBranchIds);
    await this.assertNonOwnerRoles(uniqueRoleIds);

    const resolved = await this.resolveJobFunctionsAndSpecialties(
      jobFunctionCodes,
      specialtyCodes,
    );

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
          executive_title: dto.executive_title ?? null,
          engagement_type: dto.engagement_type ?? EngagementType.FULL_TIME,
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
        ...resolved.jobFunctions.map((jf) =>
          tx.profileJobFunction.create({
            data: { profile_id: profile.id, job_function_id: jf.id },
          }),
        ),
        ...resolved.specialties.map((s) =>
          tx.profileSpecialty.create({
            data: { profile_id: profile.id, specialty_id: s.id },
          }),
        ),
      ]);

      if (dto.schedule?.length) {
        await persistSchedules(tx, profile.id, dto.schedule);
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
    role?: string,
    page = 1,
    limit = 20,
    scope?: 'org' | 'mine',
  ) {
    await this.authorizationService.assertCanViewStaff(
      profileId,
      organizationId,
    );

    if (
      role !== undefined &&
      !STAFF_ROLE_NAMES.includes(
        role.toUpperCase() as (typeof STAFF_ROLE_NAMES)[number],
      )
    ) {
      throw new BadRequestException(
        `Invalid role: ${role}. Valid values: ${STAFF_ROLE_NAMES.join(', ')}`,
      );
    }

    const isOwner = await this.authorizationService.isOwner(
      profileId,
      organizationId,
    );
    // Non-OWNERs are implicitly scoped to their own branches.
    // ?scope=org is OWNER-only; for everyone else it silently degrades to "mine".
    const effectiveScope: 'org' | 'mine' =
      isOwner && scope === 'org' ? 'org' : isOwner ? (scope ?? 'org') : 'mine';

    const where: Prisma.ProfileWhereInput = {
      organization_id: organizationId,
      is_deleted: false,
      is_active: true,
    };
    if (branchId) {
      where.branches = { some: { branch_id: branchId } };
    } else if (effectiveScope === 'mine') {
      const callerBranches =
        await this.authorizationService.getEffectiveBranchIds(
          profileId,
          organizationId,
        );
      if (!callerBranches.length) {
        return paginated([], { page, limit, total: 0 });
      }
      where.branches = { some: { branch_id: { in: callerBranches } } };
    }
    if (role) {
      where.roles = { some: { role: { name: role.toUpperCase() } } };
    }

    const [profiles, total] = await Promise.all([
      this.prismaService.db.profile.findMany({
        where,
        include: this.staffInclude(),
        orderBy: { created_at: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaService.db.profile.count({ where }),
    ]);

    return paginated(
      profiles.map((p) => this.toStaffResponse(p)),
      { page, limit, total },
    );
  }

  async updateStaff(
    callerProfileId: string,
    organizationId: string,
    staffProfileId: string,
    dto: UpdateStaffDto,
  ) {
    await this.authorizationService.assertCanManageStaffForTarget(
      callerProfileId,
      organizationId,
      staffProfileId,
    );

    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        id: staffProfileId,
        organization_id: organizationId,
        is_deleted: false,
      },
      include: {
        user: true,
        branches: { select: { branch_id: true } },
      },
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
      // Role assignment is OWNER-only (per spec). Non-OWNERs cannot edit
      // role_ids at all — even adding a STAFF role is blocked, since a
      // BRANCH_MANAGER could otherwise grant access they don't possess.
      await this.authorizationService.assertOwnerOnly(
        callerProfileId,
        organizationId,
      );
      await this.assertNonOwnerRoles(uniqueRoleIds);
    }

    if (dto.branch_ids) {
      uniqueBranchIds = [...new Set(dto.branch_ids)];
      await this.assertBranchesInOrganization(organizationId, uniqueBranchIds);
      // Intersect rule: only branches in the symmetric difference between
      // the staff's current branches and the new set need to be in the
      // caller's scope. Branches that are unchanged on both sides don't.
      const currentBranchIds = profile.branches.map((b) => b.branch_id);
      const currentSet = new Set(currentBranchIds);
      const newSet = new Set(uniqueBranchIds);
      const diff = [
        ...currentBranchIds.filter((id) => !newSet.has(id)),
        ...uniqueBranchIds.filter((id) => !currentSet.has(id)),
      ];
      if (diff.length) {
        await this.authorizationService.assertCanManageStaffOnBranches(
          callerProfileId,
          organizationId,
          diff,
        );
      }
    }

    const resolved = await this.resolveJobFunctionsAndSpecialties(
      dto.job_function_codes ? [...new Set(dto.job_function_codes)] : undefined,
      dto.specialty_codes ? [...new Set(dto.specialty_codes)] : undefined,
    );

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
      const profileUpdate: Prisma.ProfileUpdateInput = {};
      if (dto.executive_title !== undefined) {
        profileUpdate.executive_title = dto.executive_title;
      }
      if (dto.engagement_type !== undefined) {
        profileUpdate.engagement_type = dto.engagement_type;
      }
      if (Object.keys(profileUpdate).length > 0) {
        await tx.profile.update({
          where: { id: staffProfileId },
          data: profileUpdate,
        });
      }

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

      if (dto.job_function_codes !== undefined) {
        await tx.profileJobFunction.deleteMany({
          where: { profile_id: staffProfileId },
        });
        await Promise.all(
          resolved.jobFunctions.map((jf) =>
            tx.profileJobFunction.create({
              data: { profile_id: staffProfileId, job_function_id: jf.id },
            }),
          ),
        );
      }

      if (dto.specialty_codes !== undefined) {
        await tx.profileSpecialty.deleteMany({
          where: { profile_id: staffProfileId },
        });
        await Promise.all(
          resolved.specialties.map((s) =>
            tx.profileSpecialty.create({
              data: { profile_id: staffProfileId, specialty_id: s.id },
            }),
          ),
        );
      }

      if (dto.schedule?.length) {
        await persistSchedules(tx, staffProfileId, dto.schedule);
      }

      const updated = await tx.profile.findFirst({
        where: { id: staffProfileId },
        include: this.staffInclude(),
      });

      return this.toStaffResponse(updated!);
    });
  }

  async deleteStaff(
    callerProfileId: string,
    organizationId: string,
    staffProfileId: string,
  ) {
    // Full profile delete is OWNER-only. BRANCH_MANAGER can only unassign
    // staff from a branch (DELETE /staff/:id/branches/:branchId).
    await this.authorizationService.assertOwnerOnly(
      callerProfileId,
      organizationId,
    );

    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        id: staffProfileId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!profile) throw new NotFoundException('Staff member not found');

    if (staffProfileId === callerProfileId) {
      throw new BadRequestException('Cannot delete your own staff profile');
    }

    await this.prismaService.db.profile.update({
      where: { id: staffProfileId },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  async unassignStaffFromBranch(
    callerProfileId: string,
    organizationId: string,
    staffProfileId: string,
    branchId: string,
  ) {
    // Caller must be able to manage staff on this specific branch.
    await this.authorizationService.assertCanManageStaffOnBranches(
      callerProfileId,
      organizationId,
      [branchId],
    );

    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        id: staffProfileId,
        organization_id: organizationId,
        is_deleted: false,
      },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Staff member not found');

    const link = await this.prismaService.db.profileBranch.findFirst({
      where: {
        profile_id: staffProfileId,
        branch_id: branchId,
        organization_id: organizationId,
      },
      select: { id: true },
    });
    if (!link) {
      throw new NotFoundException('Staff is not assigned to this branch');
    }

    await this.prismaService.db.$transaction(async (tx) => {
      await tx.profileBranch.delete({ where: { id: link.id } });
      // Drop schedule rows for this branch since they're now meaningless.
      await tx.workingSchedule.deleteMany({
        where: { profile_id: staffProfileId, branch_id: branchId },
      });
    });
  }

  private staffInclude() {
    return {
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
      job_functions: { include: { job_function: true } },
      specialty_links: { include: { specialty: true } },
      workingSchedules: {
        include: { days: { include: { shifts: true } } },
      },
    } satisfies Prisma.ProfileInclude;
  }

  private toStaffResponse(p: {
    id: string;
    user_id: string;
    executive_title: ExecutiveTitle | null;
    engagement_type: EngagementType;
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
    job_functions: {
      job_function: {
        id: string;
        code: string;
        name: string;
        is_clinical: boolean;
      };
    }[];
    specialty_links: {
      specialty: { id: string; code: string; name: string };
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
      executive_title: p.executive_title,
      engagement_type: p.engagement_type,
      roles: p.roles.map((r) => ({ id: r.role.id, name: r.role.name })),
      branches: p.branches.map((b) => ({
        id: b.branch.id,
        name: b.branch.name,
        city: b.branch.city,
        governorate: b.branch.governorate,
      })),
      job_functions: p.job_functions.map((jf) => ({
        id: jf.job_function.id,
        code: jf.job_function.code,
        name: jf.job_function.name,
        is_clinical: jf.job_function.is_clinical,
      })),
      specialties: p.specialty_links.map((sl) => ({
        id: sl.specialty.id,
        code: sl.specialty.code,
        name: sl.specialty.name,
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

  private async assertNonOwnerRoles(roleIds: string[]) {
    const roles = await this.prismaService.db.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, name: true },
    });
    if (roles.length !== roleIds.length) {
      throw new NotFoundException('One or more roles were not found');
    }
    if (roles.some((r) => r.name === 'OWNER')) {
      throw new BadRequestException(
        'OWNER role cannot be assigned via staff endpoints; it is reserved for the organization founder.',
      );
    }
  }

  private async resolveJobFunctionsAndSpecialties(
    jobFunctionCodes?: string[],
    specialtyCodes?: string[],
  ): Promise<ResolvedAccess> {
    const [jobFunctions, specialties] = await Promise.all([
      jobFunctionCodes && jobFunctionCodes.length
        ? this.prismaService.db.jobFunction.findMany({
            where: { code: { in: jobFunctionCodes } },
          })
        : Promise.resolve([] as JobFunction[]),
      specialtyCodes && specialtyCodes.length
        ? this.prismaService.db.specialty.findMany({
            where: { code: { in: specialtyCodes }, is_deleted: false },
          })
        : Promise.resolve([] as Specialty[]),
    ]);

    if (jobFunctionCodes && jobFunctions.length !== jobFunctionCodes.length) {
      const found = new Set(jobFunctions.map((jf) => jf.code));
      const missing = jobFunctionCodes.filter((c) => !found.has(c));
      throw new BadRequestException(
        `Unknown job_function_codes: ${missing.join(', ')}`,
      );
    }
    if (specialtyCodes && specialties.length !== specialtyCodes.length) {
      const found = new Set(specialties.map((s) => s.code));
      const missing = specialtyCodes.filter((c) => !found.has(c));
      throw new BadRequestException(
        `Unknown specialty_codes: ${missing.join(', ')}`,
      );
    }

    return { jobFunctions, specialties };
  }
}
