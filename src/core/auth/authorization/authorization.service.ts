import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

const ORGANIZATION_MANAGER_ROLES = ['OWNER'];
const BRANCH_MANAGER_ROLES = ['OWNER'];
const STAFF_MANAGER_ROLES = ['OWNER', 'BRANCH_MANAGER'];
const STAFF_VIEWER_ROLES = ['OWNER', 'BRANCH_MANAGER'];
const STAFF_VIEWER_JOB_FUNCTIONS = ['RECEPTIONIST'];
const ORG_WIDE_ROLES = ['OWNER'];
const OWNER_ONLY_ROLES = ['OWNER'];

@Injectable()
export class AuthorizationService {
  constructor(private readonly prismaService: PrismaService) {}

  async getProfileContext(
    userId: string,
    profileId: string,
    organizationId: string,
    activeBranchId?: string,
  ) {
    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        id: profileId,
        user_id: userId,
        organization_id: organizationId,
        is_active: true,
        is_deleted: false,
        organization: { status: 'ACTIVE', is_deleted: false },
      },
      include: {
        roles: { include: { role: true } },
      },
    });

    if (!profile) {
      throw new ForbiddenException('Invalid profile context');
    }

    const branchIds = await this.getEffectiveBranchIds(
      profileId,
      organizationId,
    );

    return {
      userId,
      profileId,
      organizationId,
      activeBranchId,
      roles: profile.roles.map((item) => item.role.code),
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
      where: { profile_id: profileId, organization_id: organizationId },
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

  async assertCanManageOrganization(
    profileId: string,
    organizationId: string,
  ): Promise<void> {
    if (!(await this.canManageOrganization(profileId, organizationId))) {
      throw new ForbiddenException('Organization management access denied');
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
          {
            roles: {
              some: { role: { name: { in: STAFF_VIEWER_ROLES } } },
            },
          },
          {
            job_functions: {
              some: {
                job_function: { code: { in: STAFF_VIEWER_JOB_FUNCTIONS } },
              },
            },
          },
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
    roleIds: string[],
  ): Promise<void> {
    if (!roleIds.length) return;
    if (await this.isOwner(callerProfileId, organizationId)) return;
    const privileged = await this.prismaService.db.role.findMany({
      where: { id: { in: roleIds }, code: { in: ['OWNER', 'BRANCH_MANAGER'] } },
      select: { code: true },
    });
    if (privileged.length) {
      throw new ForbiddenException(
        `Only OWNER can assign privileged roles: ${privileged
          .map((r) => r.code)
          .join(', ')}`,
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
    const match = await this.prismaService.db.profileRole.findFirst({
      where: {
        profile_id: profileId,
        profile: {
          organization_id: organizationId,
          is_deleted: false,
          is_active: true,
        },
        role: { name: { in: roles } },
      },
      select: { id: true },
    });
    return !!match;
  }
}
