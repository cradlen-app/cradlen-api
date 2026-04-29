import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

const ACCOUNT_MANAGER_ROLES = ['OWNER'];
const BRANCH_MANAGER_ROLES = ['OWNER'];
const STAFF_MANAGER_ROLES = ['OWNER'];

@Injectable()
export class AuthorizationService {
  constructor(private readonly prismaService: PrismaService) {}

  async getProfileContext(
    userId: string,
    profileId: string,
    accountId: string,
  ) {
    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        id: profileId,
        user_id: userId,
        account_id: accountId,
        is_active: true,
        is_deleted: false,
        account: { status: 'ACTIVE', is_deleted: false },
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
      accountId,
      roles: profile.roles.map((item) => item.role.name),
      branchIds: profile.branches.map((item) => item.branch_id),
    };
  }

  async canManageAccount(
    profileId: string,
    accountId: string,
  ): Promise<boolean> {
    return this.hasAnyRole(profileId, accountId, ACCOUNT_MANAGER_ROLES);
  }

  async canManageBranch(
    profileId: string,
    accountId: string,
    branchId: string,
  ): Promise<boolean> {
    const [hasRole, hasBranch] = await Promise.all([
      this.hasAnyRole(profileId, accountId, BRANCH_MANAGER_ROLES),
      this.prismaService.db.profileBranch.findFirst({
        where: {
          profile_id: profileId,
          account_id: accountId,
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
          account: { status: 'ACTIVE', is_deleted: false },
        },
        branch: { status: 'ACTIVE', is_deleted: false },
      },
      select: { id: true },
    });
    return !!match;
  }

  async canManageStaff(profileId: string, accountId: string): Promise<boolean> {
    return this.hasAnyRole(profileId, accountId, STAFF_MANAGER_ROLES);
  }

  async assertCanManageAccount(
    profileId: string,
    accountId: string,
  ): Promise<void> {
    if (!(await this.canManageAccount(profileId, accountId))) {
      throw new ForbiddenException('Account management access denied');
    }
  }

  async assertCanManageBranch(
    profileId: string,
    accountId: string,
    branchId: string,
  ): Promise<void> {
    if (!(await this.canManageBranch(profileId, accountId, branchId))) {
      throw new ForbiddenException('Branch management access denied');
    }
  }

  async assertCanManageStaff(
    profileId: string,
    accountId: string,
  ): Promise<void> {
    if (!(await this.canManageStaff(profileId, accountId))) {
      throw new ForbiddenException('Staff management access denied');
    }
  }

  private async hasAnyRole(
    profileId: string,
    accountId: string,
    roles: string[],
  ): Promise<boolean> {
    const match = await this.prismaService.db.profileRole.findFirst({
      where: {
        profile_id: profileId,
        profile: { account_id: accountId, is_deleted: false, is_active: true },
        role: { name: { in: roles } },
      },
      select: { id: true },
    });
    return !!match;
  }
}
