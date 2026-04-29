import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import type { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto.js';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async listBranches(profileId: string, accountId: string) {
    await this.authorizationService.assertCanManageAccount(
      profileId,
      accountId,
    );
    return this.prismaService.db.branch.findMany({
      where: { account_id: accountId, is_deleted: false },
      orderBy: [{ is_main: 'desc' }, { created_at: 'asc' }],
    });
  }

  async createBranch(
    profileId: string,
    accountId: string,
    dto: CreateBranchDto,
  ) {
    await this.authorizationService.assertCanManageAccount(
      profileId,
      accountId,
    );
    return this.prismaService.db.$transaction(async (tx) => {
      if (dto.is_main) {
        await tx.branch.updateMany({
          where: { account_id: accountId, is_deleted: false, is_main: true },
          data: { is_main: false },
        });
      }
      return tx.branch.create({
        data: {
          account_id: accountId,
          name: dto.name,
          address: dto.address,
          city: dto.city,
          governorate: dto.governorate,
          country: dto.country,
          is_main: dto.is_main ?? false,
        },
      });
    });
  }

  async updateBranch(
    profileId: string,
    accountId: string,
    branchId: string,
    dto: UpdateBranchDto,
  ) {
    await this.authorizationService.assertCanManageBranch(
      profileId,
      accountId,
      branchId,
    );
    const branch = await this.prismaService.db.branch.findFirst({
      where: { id: branchId, account_id: accountId, is_deleted: false },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    if (branch.is_main && dto.is_main === false) {
      throw new BadRequestException('At least one branch must remain main');
    }

    return this.prismaService.db.$transaction(async (tx) => {
      if (dto.is_main) {
        await tx.branch.updateMany({
          where: {
            account_id: accountId,
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
}
