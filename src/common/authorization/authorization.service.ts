import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

const ORGANIZATION_MANAGER_ROLES = ['OWNER'];
const BRANCH_MANAGER_ROLES = ['OWNER'];
const STAFF_MANAGER_ROLES = ['OWNER'];

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
        branches: { select: { branch_id: true } },
      },
    });

    if (!profile) {
      throw new ForbiddenException('Invalid profile context');
    }

    return {
      userId,
      profileId,
      organizationId,
      activeBranchId,
      roles: profile.roles.map((item) => item.role.name),
      branchIds: profile.branches.map((item) => item.branch_id),
    };
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

  async canAccessBranch(profileId: string, branchId: string): Promise<boolean> {
    const match = await this.prismaService.db.profileBranch.findFirst({
      where: {
        profile_id: profileId,
        branch_id: branchId,
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
