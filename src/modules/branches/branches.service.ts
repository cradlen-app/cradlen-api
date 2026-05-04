import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import type { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto.js';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async listBranches(profileId: string, organizationId: string) {
    await this.authorizationService.assertCanManageOrganization(
      profileId,
      organizationId,
    );
    return this.prismaService.db.branch.findMany({
      where: { organization_id: organizationId, is_deleted: false },
      orderBy: [{ is_main: 'desc' }, { created_at: 'asc' }],
    });
  }

  async createBranch(
    profileId: string,
    organizationId: string,
    dto: CreateBranchDto,
  ) {
    await this.authorizationService.assertCanManageOrganization(
      profileId,
      organizationId,
    );
    await this.subscriptionsService.assertBranchLimit(organizationId);
    return this.prismaService.db.$transaction(async (tx) => {
      if (dto.is_main) {
        await tx.branch.updateMany({
          where: {
            organization_id: organizationId,
            is_deleted: false,
            is_main: true,
          },
          data: { is_main: false },
        });
      }
      const branch = await tx.branch.create({
        data: {
          organization_id: organizationId,
          name: dto.name,
          address: dto.address,
          city: dto.city,
          governorate: dto.governorate,
          country: dto.country,
          is_main: dto.is_main ?? false,
        },
      });
      await tx.profileBranch.create({
        data: {
          profile_id: profileId,
          branch_id: branch.id,
          organization_id: organizationId,
        },
      });
      return branch;
    });
  }

  async updateBranch(
    profileId: string,
    organizationId: string,
    branchId: string,
    dto: UpdateBranchDto,
  ) {
    await this.authorizationService.assertCanManageBranch(
      profileId,
      organizationId,
      branchId,
    );
    const branch = await this.prismaService.db.branch.findFirst({
      where: {
        id: branchId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    if (branch.is_main && dto.is_main === false) {
      throw new BadRequestException('At least one branch must remain main');
    }

    return this.prismaService.db.$transaction(async (tx) => {
      if (dto.is_main) {
        await tx.branch.updateMany({
          where: {
            organization_id: organizationId,
            id: { not: branchId },
            is_deleted: false,
            is_main: true,
          },
          data: { is_main: false },
        });
      }
      return tx.branch.update({
        where: { id: branchId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.address !== undefined && { address: dto.address }),
          ...(dto.city !== undefined && { city: dto.city }),
          ...(dto.governorate !== undefined && {
            governorate: dto.governorate,
          }),
          ...(dto.country !== undefined && { country: dto.country }),
          ...(dto.is_main !== undefined && { is_main: dto.is_main }),
        },
      });
    });
  }

  async getBranch(profileId: string, organizationId: string, branchId: string) {
    await this.authorizationService.assertCanManageBranch(
      profileId,
      organizationId,
      branchId,
    );
    const branch = await this.prismaService.db.branch.findFirst({
      where: {
        id: branchId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async deleteBranch(
    profileId: string,
    organizationId: string,
    branchId: string,
  ) {
    await this.authorizationService.assertCanManageBranch(
      profileId,
      organizationId,
      branchId,
    );
    const branch = await this.prismaService.db.branch.findFirst({
      where: {
        id: branchId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    const remainingCount = await this.prismaService.db.branch.count({
      where: { organization_id: organizationId, is_deleted: false },
    });

    const now = new Date();

    if (remainingCount === 1) {
      // Last branch — cascade delete the entire organization
      await this.prismaService.db.$transaction(async (tx) => {
        await tx.branch.update({
          where: { id: branchId },
          data: { is_deleted: true, deleted_at: now },
        });
        await tx.profile.updateMany({
          where: { organization_id: organizationId, is_deleted: false },
          data: { is_deleted: true, deleted_at: now },
        });
        await tx.organization.update({
          where: { id: organizationId },
          data: { is_deleted: true, deleted_at: now },
        });
      });
      return;
    }

    if (branch.is_main) {
      // Main branch with siblings — promote the oldest remaining branch
      await this.prismaService.db.$transaction(async (tx) => {
        await tx.branch.update({
          where: { id: branchId },
          data: { is_deleted: true, deleted_at: now },
        });
        const oldest = await tx.branch.findFirst({
          where: {
            organization_id: organizationId,
            id: { not: branchId },
            is_deleted: false,
          },
          orderBy: { created_at: 'asc' },
        });
        if (oldest) {
          await tx.branch.update({
            where: { id: oldest.id },
            data: { is_main: true },
          });
        }
      });
      return;
    }

    // Regular branch — soft-delete only
    await this.prismaService.db.branch.update({
      where: { id: branchId },
      data: { is_deleted: true, deleted_at: now },
    });
  }
}
