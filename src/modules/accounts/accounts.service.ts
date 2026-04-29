import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import type { UpdateAccountDto } from './dto/update-account.dto.js';

@Injectable()
export class AccountsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async getAccount(profileId: string, accountId: string) {
    await this.authorizationService.assertCanManageAccount(
      profileId,
      accountId,
    );
    const account = await this.prismaService.db.account.findFirst({
      where: { id: accountId, is_deleted: false },
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  async updateAccount(
    profileId: string,
    accountId: string,
    dto: UpdateAccountDto,
  ) {
    await this.authorizationService.assertCanManageAccount(
      profileId,
      accountId,
    );
    return this.prismaService.db.account.update({
      where: { id: accountId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.specialities !== undefined && {
          specialities: dto.specialities,
        }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }
}
