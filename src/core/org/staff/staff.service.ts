import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { EngagementType, Prisma } from '@prisma/client';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import {
  STAFF_ROLE_NAMES,
  type CreateStaffDto,
  type ListStaffQueryDto,
  type UpdateStaffDto,
} from './dto/staff.dto.js';
import { persistSchedules } from './schedule.helpers.js';
import { createUserWithGeneratedEmail } from './staff-email.helper.js';
import {
  assertBranchesInOrganization,
  assertNonOwnerRoles,
  assertScheduleBranches,
  assertShiftTimes,
  resolveJobFunctionsAndSpecialties,
} from './staff.assertions.js';
import { staffInclude, toStaffResponse } from './staff.mapper.js';
import {
  diffIds,
  replaceProfileBranches,
  replaceProfileJobFunctions,
  replaceProfileRoles,
  replaceProfileSpecialties,
  syncProfileBranches,
  syncProfileJobFunctions,
  syncProfileRoles,
  syncProfileSpecialties,
} from './staff-m2m.helper.js';

/**
 * JobFunction codes that count as "doctors" for the `doctors_only=true`
 * staff filter — used by the book-visit `assigned_doctor` picker. Nurses
 * and assistants are clinical (`is_clinical=true`) but NOT doctors, so we
 * filter by these explicit codes rather than the `is_clinical` flag.
 */
const DOCTOR_JOB_FUNCTION_CODES: string[] = [
  'OBGYN',
  'ANESTHESIOLOGIST',
  'PEDIATRICIAN',
  'OTHER_DOCTOR',
];

@Injectable()
export class StaffService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly storageService: StorageService,
  ) {}

  async createStaff(
    profileId: string,
    organizationId: string,
    branchId: string,
    dto: CreateStaffDto,
  ) {
    const uniqueRoleIds = [...new Set(dto.role_ids)];
    const uniqueBranchIds = [...new Set(dto.branch_ids)];
    const jobFunctionCodes = [...new Set(dto.job_function_codes ?? [])];
    const specialtyCodes = [...new Set(dto.specialty_codes ?? [])];

    // The staff must be assigned to the branch in the path (mirrors invitations).
    if (!uniqueBranchIds.includes(branchId)) {
      throw new BadRequestException(
        'branch_ids must include the path branchId',
      );
    }

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

    await assertBranchesInOrganization(
      this.prismaService,
      organizationId,
      uniqueBranchIds,
    );
    await assertNonOwnerRoles(this.prismaService, uniqueRoleIds);

    const resolved = await resolveJobFunctionsAndSpecialties(
      this.prismaService,
      jobFunctionCodes,
      specialtyCodes,
    );

    if (dto.schedule?.length) {
      assertScheduleBranches(dto.schedule, uniqueBranchIds);
      assertShiftTimes(dto.schedule);
    }

    // TOCTOU: `phone_number` is not @unique on User, so this pre-check is the
    // de-facto collision defense. A proper fix is a Prisma migration adding a
    // unique partial index. Until then, concurrent admin invocations CAN race.
    const existingByPhone = await this.prismaService.db.user.findFirst({
      where: { phone_number: dto.phone_number, is_deleted: false },
      select: { id: true },
    });
    if (existingByPhone) {
      throw new ConflictException(
        'A user with this phone number already exists',
      );
    }

    const passwordHashed = await bcrypt.hash(dto.password, 12);

    return this.prismaService.db.$transaction(async (tx) => {
      const user = await createUserWithGeneratedEmail(tx, {
        first_name: dto.first_name,
        last_name: dto.last_name,
        phone_number: dto.phone_number,
        password_hashed: passwordHashed,
      });

      const profile = await tx.profile.create({
        data: {
          user_id: user.id,
          organization_id: organizationId,
          executive_title: dto.executive_title ?? null,
          engagement_type: dto.engagement_type ?? EngagementType.FULL_TIME,
        },
      });

      await replaceProfileRoles(tx, profile.id, uniqueRoleIds);
      await replaceProfileBranches(
        tx,
        profile.id,
        organizationId,
        uniqueBranchIds,
      );
      await replaceProfileJobFunctions(
        tx,
        profile.id,
        resolved.jobFunctions.map((jf) => jf.id),
      );
      await replaceProfileSpecialties(
        tx,
        profile.id,
        resolved.specialties.map((s) => s.id),
      );

      if (dto.schedule?.length) {
        await persistSchedules(tx, profile.id, dto.schedule);
      }

      return {
        user_id: user.id,
        profile_id: profile.id,
        organization_id: organizationId,
        generated_email: user.email,
      };
    });
  }

  async listStaff(
    profileId: string,
    organizationId: string,
    branchId: string,
    query: ListStaffQueryDto = {},
  ) {
    const {
      role,
      clinical,
      doctors_only: doctorsOnly,
      specialty_code: specialtyCode,
      search,
      job_function_codes: jobFunctionCodes,
      engagement_type: engagementType,
      executive_title: executiveTitle,
    } = query;
    const page = query.page ?? 1;
    const limit = query.limit ?? 11;

    await this.authorizationService.assertCanViewStaff(
      profileId,
      organizationId,
    );
    // Branch-scoped: caller may only list branches they can reach. OWNER passes
    // for all branches; BRANCH_MANAGER only their own.
    await this.authorizationService.assertCanAccessBranch(
      profileId,
      organizationId,
      branchId,
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

    const where: Prisma.ProfileWhereInput = {
      organization_id: organizationId,
      is_deleted: false,
      is_active: true,
      branches: { some: { branch_id: branchId } },
    };
    if (role) {
      where.roles = { some: { role: { code: role.toUpperCase() } } };
    }

    const jobFunctionFilters: Prisma.ProfileJobFunctionListRelationFilter[] =
      [];
    if (doctorsOnly === true) {
      jobFunctionFilters.push({
        some: { job_function: { code: { in: DOCTOR_JOB_FUNCTION_CODES } } },
      });
    } else if (clinical === true) {
      jobFunctionFilters.push({
        some: { job_function: { is_clinical: true } },
      });
    }
    if (jobFunctionCodes?.length) {
      jobFunctionFilters.push({
        some: { job_function: { code: { in: jobFunctionCodes } } },
      });
    }
    if (jobFunctionFilters.length === 1) {
      where.job_functions = jobFunctionFilters[0];
    } else if (jobFunctionFilters.length > 1) {
      where.AND = jobFunctionFilters.map((f) => ({ job_functions: f }));
    }

    if (specialtyCode) {
      where.specialty_links = {
        some: { specialty: { code: specialtyCode, is_deleted: false } },
      };
    }
    if (engagementType) {
      where.engagement_type = engagementType;
    }
    if (executiveTitle) {
      where.executive_title = executiveTitle;
    }
    if (search) {
      where.user = {
        OR: [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone_number: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const [profiles, total] = await Promise.all([
      this.prismaService.db.profile.findMany({
        where,
        include: staffInclude,
        orderBy: { created_at: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaService.db.profile.count({ where }),
    ]);

    const items = await Promise.all(
      profiles.map(async (p) => ({
        ...toStaffResponse(p),
        profile_image_url: p.profile_image_object_key
          ? await this.storageService.createPresignedDownloadUrl(
              p.profile_image_object_key,
            )
          : null,
      })),
    );

    return paginated(items, { page, limit, total });
  }

  async updateStaff(
    callerProfileId: string,
    organizationId: string,
    branchId: string,
    staffProfileId: string,
    dto: UpdateStaffDto,
  ) {
    // Branch-scoped: caller must manage this branch, and the target must be
    // assigned to it.
    await this.authorizationService.assertCanManageStaffOnBranches(
      callerProfileId,
      organizationId,
      [branchId],
    );
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
        branches: { some: { branch_id: branchId } },
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
      await assertNonOwnerRoles(this.prismaService, uniqueRoleIds);
    }

    if (dto.branch_ids) {
      uniqueBranchIds = [...new Set(dto.branch_ids)];
      await assertBranchesInOrganization(
        this.prismaService,
        organizationId,
        uniqueBranchIds,
      );
      // Intersect rule: only branches in the symmetric difference between
      // the staff's current branches and the new set need to be in the
      // caller's scope. Branches that are unchanged on both sides don't.
      const currentBranchIds = profile.branches.map((b) => b.branch_id);
      const { toAdd, toRemove } = diffIds(currentBranchIds, uniqueBranchIds);
      const diff = [...toAdd, ...toRemove];
      if (diff.length) {
        await this.authorizationService.assertCanManageStaffOnBranches(
          callerProfileId,
          organizationId,
          diff,
        );
      }
    }

    const resolved = await resolveJobFunctionsAndSpecialties(
      this.prismaService,
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
      assertScheduleBranches(dto.schedule, effectiveBranchIds);
      assertShiftTimes(dto.schedule);
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
        await syncProfileRoles(tx, staffProfileId, uniqueRoleIds);
      }

      if (uniqueBranchIds) {
        await syncProfileBranches(
          tx,
          staffProfileId,
          organizationId,
          uniqueBranchIds,
        );
      }

      if (dto.job_function_codes !== undefined) {
        await syncProfileJobFunctions(
          tx,
          staffProfileId,
          resolved.jobFunctions.map((jf) => jf.id),
        );
      }

      if (dto.specialty_codes !== undefined) {
        await syncProfileSpecialties(
          tx,
          staffProfileId,
          resolved.specialties.map((s) => s.id),
        );
      }

      if (dto.schedule?.length) {
        await persistSchedules(tx, staffProfileId, dto.schedule);
      }

      const updated = await tx.profile.findFirst({
        where: { id: staffProfileId },
        include: staffInclude,
      });

      return toStaffResponse(updated!);
    });
  }

  async removeStaffFromBranch(
    callerProfileId: string,
    organizationId: string,
    branchId: string,
    staffProfileId: string,
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

    // Count remaining branches to decide whether this is the last one.
    const branchCount = await this.prismaService.db.profileBranch.count({
      where: { profile_id: staffProfileId, organization_id: organizationId },
    });
    const isLastBranch = branchCount <= 1;

    // Removing a staff from their last branch soft-deletes the profile, so
    // guard against a caller orphaning (and deleting) themselves.
    if (isLastBranch && staffProfileId === callerProfileId) {
      throw new BadRequestException('Cannot delete your own staff profile');
    }

    await this.prismaService.db.$transaction(async (tx) => {
      await tx.profileBranch.delete({ where: { id: link.id } });
      // Drop schedule rows for this branch since they're now meaningless.
      await tx.workingSchedule.deleteMany({
        where: { profile_id: staffProfileId, branch_id: branchId },
      });
      // No branches left → the profile is no longer reachable anywhere, so
      // soft-delete it rather than leave an invisible orphan.
      if (isLastBranch) {
        await tx.profile.update({
          where: { id: staffProfileId },
          data: { is_deleted: true, deleted_at: new Date() },
        });
      }
    });
  }
}
