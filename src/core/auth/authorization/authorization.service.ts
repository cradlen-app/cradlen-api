import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

const ORGANIZATION_MANAGER_ROLES = ['OWNER'];
// Owners manage any branch; branch managers manage the branches they belong to.
// `canManageBranch` additionally requires a matching `ProfileBranch` row for
// non-owners, so this stays scoped to a manager's own branch(es).
const BRANCH_MANAGER_ROLES = ['OWNER', 'BRANCH_MANAGER'];
const STAFF_MANAGER_ROLES = ['OWNER', 'BRANCH_MANAGER'];
const STAFF_VIEWER_ROLES = ['OWNER', 'BRANCH_MANAGER'];
const STAFF_VIEWER_JOB_FUNCTIONS = ['RECEPTIONIST'];
const ORG_WIDE_ROLES = ['OWNER'];
const OWNER_ONLY_ROLES = ['OWNER'];
const MANAGER_ROLES = ['OWNER', 'BRANCH_MANAGER'];

@Injectable()
export class AuthorizationService {
  constructor(private readonly prismaService: PrismaService) {}

  async getProfileContext(
    userId: string,
    profileId: string,
    organizationId: string,
    activeBranchId?: string,
    issuedAtSeconds?: number,
  ) {
    // Single query covers profile + user-alive + org-active + roles.
    // Replaces the prior 3-query path (user.findFirst in the caller,
    // profile.findFirst, hasAnyRole inside getEffectiveBranchIds).
    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        id: profileId,
        user_id: userId,
        organization_id: organizationId,
        is_active: true,
        is_deleted: false,
        user: { is_deleted: false, is_active: true },
        organization: { status: 'ACTIVE', is_deleted: false },
      },
      include: {
        role: true,
        job_function: true,
        user: { select: { password_changed_at: true } },
      },
    });

    if (!profile) {
      // Same status as the prior 'User not found or inactive' from the
      // JWT strategy; the merged query can't distinguish "user gone" vs
      // "profile gone" without a second round-trip, and from the
      // client's perspective both mean "re-authenticate".
      throw new UnauthorizedException('Invalid auth context');
    }

    // Reject an access token minted before the user's last password change so a
    // credential reset invalidates outstanding access tokens immediately (not
    // just refresh tokens). `iat` is epoch-seconds; compare against the change
    // instant floored to seconds so a token issued in the same second is kept.
    const changedAt = profile.user?.password_changed_at;
    if (
      issuedAtSeconds !== undefined &&
      changedAt &&
      issuedAtSeconds < Math.floor(changedAt.getTime() / 1000)
    ) {
      throw new UnauthorizedException('Token issued before password change');
    }

    const isOwner = profile.role.name === 'OWNER';
    const branchIds = isOwner
      ? (
          await this.prismaService.db.branch.findMany({
            where: { organization_id: organizationId, is_deleted: false },
            select: { id: true },
          })
        ).map((b) => b.id)
      : (
          await this.prismaService.db.profileBranch.findMany({
            where: {
              profile_id: profileId,
              organization_id: organizationId,
              branch: { is_deleted: false },
            },
            select: { branch_id: true },
          })
        ).map((l) => l.branch_id);

    return {
      userId,
      profileId,
      organizationId,
      activeBranchId,
      role: profile.role.code,
      jobFunction: profile.job_function?.code ?? null,
      isClinical: profile.job_function?.is_clinical ?? false,
      branchIds,
    };
  }

  async getEffectiveBranchIds(
    profileId: string,
    organizationId: string,
  ): Promise<string[]> {
    if (await this.hasAnyRole(profileId, organizationId, ORG_WIDE_ROLES)) {
      const branches = await this.prismaService.db.branch.findMany({
        where: { organization_id: organizationId, is_deleted: false },
        select: { id: true },
      });
      return branches.map((b) => b.id);
    }
    const links = await this.prismaService.db.profileBranch.findMany({
      where: {
        profile_id: profileId,
        organization_id: organizationId,
        branch: { is_deleted: false },
      },
      select: { branch_id: true },
    });
    return links.map((l) => l.branch_id);
  }

  async canManageOrganization(
    profileId: string,
    organizationId: string,
  ): Promise<boolean> {
    return this.hasAnyRole(
      profileId,
      organizationId,
      ORGANIZATION_MANAGER_ROLES,
    );
  }

  async canManageBranch(
    profileId: string,
    organizationId: string,
    branchId: string,
  ): Promise<boolean> {
    if (await this.hasAnyRole(profileId, organizationId, ORG_WIDE_ROLES)) {
      const branch = await this.prismaService.db.branch.findFirst({
        where: {
          id: branchId,
          organization_id: organizationId,
          is_deleted: false,
        },
        select: { id: true },
      });
      return !!branch;
    }
    const [hasRole, hasBranch] = await Promise.all([
      this.hasAnyRole(profileId, organizationId, BRANCH_MANAGER_ROLES),
      this.prismaService.db.profileBranch.findFirst({
        where: {
          profile_id: profileId,
          organization_id: organizationId,
          branch_id: branchId,
        },
        select: { id: true },
      }),
    ]);
    return hasRole && !!hasBranch;
  }

  async canAccessBranch(
    profileId: string,
    organizationId: string,
    branchId: string,
  ): Promise<boolean> {
    if (await this.hasAnyRole(profileId, organizationId, ORG_WIDE_ROLES)) {
      const branch = await this.prismaService.db.branch.findFirst({
        where: {
          id: branchId,
          organization_id: organizationId,
          is_deleted: false,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      return !!branch;
    }
    const match = await this.prismaService.db.profileBranch.findFirst({
      where: {
        profile_id: profileId,
        branch_id: branchId,
        organization_id: organizationId,
        profile: {
          is_deleted: false,
          is_active: true,
          organization: { status: 'ACTIVE', is_deleted: false },
        },
        branch: { status: 'ACTIVE', is_deleted: false },
      },
      select: { id: true },
    });
    return !!match;
  }

  async assertCanAccessBranch(
    profileId: string,
    organizationId: string,
    branchId: string,
  ): Promise<void> {
    if (!(await this.canAccessBranch(profileId, organizationId, branchId))) {
      throw new ForbiddenException('Branch access denied');
    }
  }

  async canManageStaff(
    profileId: string,
    organizationId: string,
  ): Promise<boolean> {
    return this.hasAnyRole(profileId, organizationId, STAFF_MANAGER_ROLES);
  }

  /**
   * Whether the profile is an organization manager — owner or branch manager.
   * The single source of truth for "sees all providers' data" vs "scoped to self".
   */
  async isManager(profileId: string, organizationId: string): Promise<boolean> {
    return this.hasAnyRole(profileId, organizationId, MANAGER_ROLES);
  }

  /**
   * Whether the profile may view financial reports across the branch/org (all
   * providers). Owners and branch managers qualify; anyone else (e.g. a doctor)
   * is restricted to their own revenue by the reporting layer.
   */
  async canViewAllFinancials(
    profileId: string,
    organizationId: string,
  ): Promise<boolean> {
    return this.isManager(profileId, organizationId);
  }

  /**
   * Whether the caller may only see their own data: a non-manager clinician
   * (a doctor). Reception, owners and branch managers are not restricted (they
   * see the full branch). Used to scope the patients directory and analytics
   * server-side, independent of any client-supplied flag.
   */
  async isRestrictedToOwnData(
    profileId: string,
    organizationId: string,
  ): Promise<boolean> {
    if (await this.isManager(profileId, organizationId)) return false;
    return this.isClinical(profileId);
  }

  async assertCanManageOrganization(
    profileId: string,
    organizationId: string,
  ): Promise<void> {
    if (!(await this.canManageOrganization(profileId, organizationId))) {
      throw new ForbiddenException('Organization management access denied');
    }
  }

  /**
   * Any active, non-deleted member of the organization. Use for reads; use
   * canManageOrganization/assertCanManageOrganization for writes.
   */
  async canAccessOrganization(
    profileId: string,
    organizationId: string,
  ): Promise<boolean> {
    const match = await this.prismaService.db.profile.findFirst({
      where: {
        id: profileId,
        organization_id: organizationId,
        is_deleted: false,
        is_active: true,
      },
      select: { id: true },
    });
    return !!match;
  }

  async assertCanAccessOrganization(
    profileId: string,
    organizationId: string,
  ): Promise<void> {
    if (!(await this.canAccessOrganization(profileId, organizationId))) {
      throw new ForbiddenException('Organization access denied');
    }
  }

  async assertCanManageBranch(
    profileId: string,
    organizationId: string,
    branchId: string,
  ): Promise<void> {
    if (!(await this.canManageBranch(profileId, organizationId, branchId))) {
      throw new ForbiddenException('Branch management access denied');
    }
  }

  async assertCanManageStaff(
    profileId: string,
    organizationId: string,
  ): Promise<void> {
    if (!(await this.canManageStaff(profileId, organizationId))) {
      throw new ForbiddenException('Staff management access denied');
    }
  }

  async canViewStaff(
    profileId: string,
    organizationId: string,
  ): Promise<boolean> {
    const match = await this.prismaService.db.profile.findFirst({
      where: {
        id: profileId,
        organization_id: organizationId,
        is_deleted: false,
        is_active: true,
        OR: [
          { role: { name: { in: STAFF_VIEWER_ROLES } } },
          { job_function: { code: { in: STAFF_VIEWER_JOB_FUNCTIONS } } },
        ],
      },
      select: { id: true },
    });
    return !!match;
  }

  async assertCanViewStaff(
    profileId: string,
    organizationId: string,
  ): Promise<void> {
    if (!(await this.canViewStaff(profileId, organizationId))) {
      throw new ForbiddenException('Staff view access denied');
    }
  }

  async isOwner(profileId: string, organizationId: string): Promise<boolean> {
    return this.hasAnyRole(profileId, organizationId, OWNER_ONLY_ROLES);
  }

  /**
   * Whether the profile holds any clinical job function (OBGYN, doctors,
   * nurses, …). Job-function-based, independent of role tier — used for
   * clinician-gated surfaces (e.g. catalog contribution, clinical viewers).
   */
  async isClinical(profileId: string): Promise<boolean> {
    const row = await this.prismaService.db.profile.findFirst({
      where: { id: profileId, job_function: { is_clinical: true } },
      select: { id: true },
    });
    return row !== null;
  }

  async assertOwnerOnly(
    profileId: string,
    organizationId: string,
  ): Promise<void> {
    if (!(await this.isOwner(profileId, organizationId))) {
      throw new ForbiddenException('OWNER role required');
    }
  }

  async canManageStaffOnBranches(
    callerProfileId: string,
    organizationId: string,
    branchIds: string[],
  ): Promise<boolean> {
    if (!(await this.canManageStaff(callerProfileId, organizationId))) {
      return false;
    }
    if (await this.isOwner(callerProfileId, organizationId)) return true;

    if (!branchIds.length) return false;
    const callerBranchIds = await this.getEffectiveBranchIds(
      callerProfileId,
      organizationId,
    );
    const callerSet = new Set(callerBranchIds);
    return branchIds.every((id) => callerSet.has(id));
  }

  async assertCanManageStaffOnBranches(
    callerProfileId: string,
    organizationId: string,
    branchIds: string[],
  ): Promise<void> {
    if (
      !(await this.canManageStaffOnBranches(
        callerProfileId,
        organizationId,
        branchIds,
      ))
    ) {
      throw new ForbiddenException(
        'Staff management denied: branches outside your scope',
      );
    }
  }

  async canManageStaffForTarget(
    callerProfileId: string,
    organizationId: string,
    targetStaffProfileId: string,
  ): Promise<boolean> {
    if (!(await this.canManageStaff(callerProfileId, organizationId))) {
      return false;
    }
    if (await this.isOwner(callerProfileId, organizationId)) return true;

    const [callerBranchIds, targetBranches] = await Promise.all([
      this.getEffectiveBranchIds(callerProfileId, organizationId),
      this.prismaService.db.profileBranch.findMany({
        where: {
          profile_id: targetStaffProfileId,
          organization_id: organizationId,
        },
        select: { branch_id: true },
      }),
    ]);
    if (!callerBranchIds.length || !targetBranches.length) return false;
    const callerSet = new Set(callerBranchIds);
    return targetBranches.some((tb) => callerSet.has(tb.branch_id));
  }

  async assertNoPrivilegedRoleAssignment(
    callerProfileId: string,
    organizationId: string,
    roleId: string,
  ): Promise<void> {
    if (await this.isOwner(callerProfileId, organizationId)) return;
    const privileged = await this.prismaService.db.role.findFirst({
      where: { id: roleId, code: { in: ['OWNER', 'BRANCH_MANAGER'] } },
      select: { code: true },
    });
    if (privileged) {
      throw new ForbiddenException(
        `Only OWNER can assign privileged roles: ${privileged.code}`,
      );
    }
  }

  async assertCanManageStaffForTarget(
    callerProfileId: string,
    organizationId: string,
    targetStaffProfileId: string,
  ): Promise<void> {
    if (
      !(await this.canManageStaffForTarget(
        callerProfileId,
        organizationId,
        targetStaffProfileId,
      ))
    ) {
      throw new ForbiddenException('Staff management denied: no shared branch');
    }
  }

  private async hasAnyRole(
    profileId: string,
    organizationId: string,
    roles: string[],
  ): Promise<boolean> {
    const match = await this.prismaService.db.profile.findFirst({
      where: {
        id: profileId,
        organization_id: organizationId,
        is_deleted: false,
        is_active: true,
        role: { name: { in: roles } },
      },
      select: { id: true },
    });
    return !!match;
  }
}
