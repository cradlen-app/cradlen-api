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
  type ResetStaffPasswordDto,
  type UpdateStaffDto,
} from './dto/staff.dto.js';
import type { RoleStatDto, StaffStatsDto } from './dto/staff-stats.dto.js';
import { persistSchedules } from './schedule.helpers.js';
import { createUserWithGeneratedEmail } from './staff-email.helper.js';
import {
  assertBranchesInOrganization,
  assertRolesExist,
  assertScheduleBranches,
  assertShiftTimes,
  resolveJobFunctionAndSpecialty,
  resolveSubspecialties,
} from './staff.assertions.js';
import { staffInclude, toStaffResponse } from './staff.mapper.js';
import {
  diffIds,
  replaceProfileBranches,
  replaceProfileSubspecialties,
  syncProfileBranches,
  syncProfileSubspecialties,
} from './staff-m2m.helper.js';

/**
 * JobFunction codes that count as "doctors" for the `doctors_only=true`
 * staff filter — used by the book-visit `assigned_doctor` picker. The job
 * function is the coarse role (DOCTOR); the clinical specialization lives in
 * Specialty, so a single code suffices.
 */
const DOCTOR_JOB_FUNCTION_CODES: string[] = ['DOCTOR'];

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
    const roleId = dto.role_id;
    const uniqueBranchIds = [...new Set(dto.branch_ids)];

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
      roleId,
    );
    await this.subscriptionsService.assertStaffLimit(organizationId);

    await assertBranchesInOrganization(
      this.prismaService,
      organizationId,
      uniqueBranchIds,
    );
    await assertRolesExist(this.prismaService, [roleId]);

    const resolved = await resolveJobFunctionAndSpecialty(
      this.prismaService,
      dto.job_function_code,
      dto.specialty_code,
    );
    const subspecialties = await resolveSubspecialties(
      this.prismaService,
      dto.subspecialty_codes,
      resolved.specialty?.id ?? null,
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
          role_id: roleId,
          job_function_id: resolved.jobFunction?.id ?? null,
          specialty_id: resolved.specialty?.id ?? null,
          executive_title: dto.executive_title ?? null,
          professional_title: dto.professional_title ?? null,
          engagement_type: dto.engagement_type ?? EngagementType.FULL_TIME,
        },
      });

      await replaceProfileBranches(
        tx,
        profile.id,
        organizationId,
        uniqueBranchIds,
      );
      await replaceProfileSubspecialties(
        tx,
        profile.id,
        subspecialties.map((s) => s.id),
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

  /**
   * Admin-initiated password reset for a staff member. This is the recovery
   * path for staff created via `createStaff`, who get a system-generated
   * `@cradlen.com` email (not a real inbox) and so cannot use the email-OTP
   * forgot-password flow. The caller sets a new password and shares it
   * out-of-band, mirroring how the original password was issued.
   */
  async resetStaffPassword(
    callerProfileId: string,
    organizationId: string,
    branchId: string,
    staffProfileId: string,
    dto: ResetStaffPasswordDto,
  ): Promise<void> {
    // Branch-scoped: caller must manage this branch, and share a branch with
    // the target. Mirrors updateStaff's authorization.
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
      select: {
        user_id: true,
        role: { select: { name: true } },
      },
    });
    if (!profile) throw new NotFoundException('Staff member not found');

    // Privileged-target guard: resetting an OWNER or BRANCH_MANAGER's password
    // could hijack a privileged account, so restrict that to OWNERs. A
    // BRANCH_MANAGER may only reset plain STAFF members.
    const targetIsPrivileged =
      profile.role.name === 'OWNER' || profile.role.name === 'BRANCH_MANAGER';
    if (targetIsPrivileged) {
      await this.authorizationService.assertOwnerOnly(
        callerProfileId,
        organizationId,
      );
    }

    const passwordHashed = await bcrypt.hash(dto.password, 12);

    // Single transaction: set the new password and revoke every active
    // session so the old credentials stop working immediately.
    await this.prismaService.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: profile.user_id },
        data: { password_hashed: passwordHashed },
      });
      await tx.refreshToken.updateMany({
        where: { user_id: profile.user_id, is_revoked: false },
        data: { is_revoked: true },
      });
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
      authorized_for_service: authorizedForService,
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
      where.role = { code: role.toUpperCase() };
    }

    const jobFunctionConditions: Prisma.JobFunctionWhereInput[] = [];
    if (doctorsOnly === true) {
      jobFunctionConditions.push({ code: { in: DOCTOR_JOB_FUNCTION_CODES } });
    } else if (clinical === true) {
      jobFunctionConditions.push({ is_clinical: true });
    }
    if (jobFunctionCodes?.length) {
      jobFunctionConditions.push({ code: { in: jobFunctionCodes } });
    }
    if (jobFunctionConditions.length === 1) {
      where.job_function = jobFunctionConditions[0];
    } else if (jobFunctionConditions.length > 1) {
      where.job_function = { AND: jobFunctionConditions };
    }

    if (specialtyCode) {
      // Subspecialists match too: their profile's specialty IS the parent.
      where.specialty = { code: specialtyCode, is_deleted: false };
    }
    // Narrow to providers authorized (active ProviderService) for a service —
    // at this branch or org-wide. Powers the service-scoped book-visit doctor
    // picker; an empty value (no service chosen) leaves the list unfiltered.
    if (authorizedForService) {
      where.provider_services = {
        some: {
          service_id: authorizedForService,
          organization_id: organizationId,
          is_active: true,
          is_deleted: false,
          OR: [{ branch_id: branchId }, { branch_id: null }],
        },
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

  /**
   * Branch staff analytics: a total + a data-driven per-role breakdown + a
   * clinical subtotal, each with a start-of-month `previous` value so the client
   * can render month-over-month trend chips. Mirrors the patient-stats engine.
   */
  async getBranchStats(
    profileId: string,
    organizationId: string,
    branchId: string,
  ): Promise<StaffStatsDto> {
    await this.authorizationService.assertCanViewStaff(
      profileId,
      organizationId,
    );
    // Branch-scoped: OWNER passes for all branches; BRANCH_MANAGER only theirs.
    await this.authorizationService.assertCanAccessBranch(
      profileId,
      organizationId,
      branchId,
    );
    return this.computeStaffStats(organizationId, branchId);
  }

  /** Local-time first day of the current month — the trend comparison baseline. */
  private startOfCurrentMonth(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  /**
   * Shared engine for {@link getBranchStats}. The per-role breakdown is
   * **discovered from the data** (a `groupBy` over the qualifying staff's role
   * links) rather than enumerated, so a new role code surfaces without code
   * changes. `previous` re-runs each count gated on when the staff member joined
   * this branch (`ProfileBranch.created_at <= cutoff`) — the branch-scoped
   * analog of the patient endpoint's `journey.started_at` cutoff.
   */
  private async computeStaffStats(
    organizationId: string,
    branchId: string,
  ): Promise<StaffStatsDto> {
    const db = this.prismaService.db;
    const cutoff = this.startOfCurrentMonth();

    const profileWhere = (opts: {
      roleCode?: string;
      clinical?: boolean;
      cutoff?: Date;
    }): Prisma.ProfileWhereInput => ({
      organization_id: organizationId,
      is_deleted: false,
      is_active: true,
      branches: {
        some: {
          branch_id: branchId,
          ...(opts.cutoff ? { created_at: { lte: opts.cutoff } } : {}),
        },
      },
      ...(opts.roleCode ? { role: { code: opts.roleCode } } : {}),
      ...(opts.clinical ? { job_function: { is_clinical: true } } : {}),
    });

    // 1. Which roles are actually held by active staff at this branch.
    const groups = await db.profile.groupBy({
      by: ['role_id'],
      where: profileWhere({}),
    });
    const roleIds = groups.map((g) => g.role_id);

    // 2. Resolve each role's code + display name.
    const roles = roleIds.length
      ? await db.role.findMany({
          where: { id: { in: roleIds } },
          select: { id: true, code: true, name: true },
        })
      : [];

    // 3. One round trip: total + clinical (current/previous) then each role pair.
    const [
      totalCurrent,
      totalPrevious,
      clinicalCurrent,
      clinicalPrevious,
      ...perRole
    ] = await db.$transaction([
      db.profile.count({ where: profileWhere({}) }),
      db.profile.count({ where: profileWhere({ cutoff }) }),
      db.profile.count({ where: profileWhere({ clinical: true }) }),
      db.profile.count({ where: profileWhere({ clinical: true, cutoff }) }),
      ...roles.flatMap((role) => [
        db.profile.count({ where: profileWhere({ roleCode: role.code }) }),
        db.profile.count({
          where: profileWhere({ roleCode: role.code, cutoff }),
        }),
      ]),
    ]);

    const by_role: RoleStatDto[] = roles
      .map((role, i) => ({
        role_code: role.code,
        role_name: role.name,
        current: perRole[i * 2] ?? 0,
        previous: perRole[i * 2 + 1] ?? 0,
      }))
      .filter((r) => r.current > 0)
      .sort((a, b) => b.current - a.current);

    return {
      total: { current: totalCurrent, previous: totalPrevious },
      by_role,
      clinical: { current: clinicalCurrent, previous: clinicalPrevious },
    };
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

    let roleId: string | undefined;
    let uniqueBranchIds: string[] | undefined;

    if (dto.role_id !== undefined) {
      roleId = dto.role_id;
      // Role assignment is OWNER-only (per spec). Non-OWNERs cannot edit
      // the role at all — even setting STAFF is blocked, since a
      // BRANCH_MANAGER could otherwise grant access they don't possess.
      await this.authorizationService.assertOwnerOnly(
        callerProfileId,
        organizationId,
      );
      await assertRolesExist(this.prismaService, [roleId]);
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

    const resolved = await resolveJobFunctionAndSpecialty(
      this.prismaService,
      dto.job_function_code,
      dto.specialty_code,
    );

    // The specialty a subspecialty must belong to: the one being set (or the
    // existing one when this PATCH doesn't touch specialty).
    const effectiveSpecialtyId =
      dto.specialty_code !== undefined
        ? (resolved.specialty?.id ?? null)
        : profile.specialty_id;

    // Resolve the subspecialty set to sync (undefined = leave untouched).
    let subspecialtyIdsToSync: string[] | undefined;
    if (dto.subspecialty_codes !== undefined) {
      const subs = await resolveSubspecialties(
        this.prismaService,
        dto.subspecialty_codes,
        effectiveSpecialtyId,
      );
      subspecialtyIdsToSync = subs.map((s) => s.id);
    } else if (
      dto.specialty_code !== undefined &&
      (resolved.specialty?.id ?? null) !== profile.specialty_id
    ) {
      // Specialty changed but subspecialties weren't sent — the old ones can't
      // survive a parent change, so clear them to avoid orphaned/mismatched links.
      subspecialtyIdsToSync = [];
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
      assertScheduleBranches(dto.schedule, effectiveBranchIds);
      assertShiftTimes(dto.schedule);
    }

    return this.prismaService.db.$transaction(async (tx) => {
      const profileUpdate: Prisma.ProfileUpdateInput = {};
      if (dto.executive_title !== undefined) {
        profileUpdate.executive_title = dto.executive_title;
      }
      if (dto.professional_title !== undefined) {
        profileUpdate.professional_title = dto.professional_title;
      }
      if (dto.engagement_type !== undefined) {
        profileUpdate.engagement_type = dto.engagement_type;
      }
      if (roleId !== undefined) {
        profileUpdate.role = { connect: { id: roleId } };
      }
      if (dto.job_function_code !== undefined) {
        const jf = resolved.jobFunction;
        profileUpdate.job_function = jf
          ? { connect: { id: jf.id } }
          : { disconnect: true };
      }
      if (dto.specialty_code !== undefined) {
        profileUpdate.specialty = resolved.specialty
          ? { connect: { id: resolved.specialty.id } }
          : { disconnect: true };
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

      if (uniqueBranchIds) {
        await syncProfileBranches(
          tx,
          staffProfileId,
          organizationId,
          uniqueBranchIds,
        );
      }

      if (subspecialtyIdsToSync !== undefined) {
        await syncProfileSubspecialties(
          tx,
          staffProfileId,
          subspecialtyIdsToSync,
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
