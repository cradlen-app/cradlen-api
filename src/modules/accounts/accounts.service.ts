import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import type { AuthConfig } from '../../config/auth.config.js';
import type { CreateAccountDto } from './dto/create-account.dto.js';
import type { UpdateAccountDto } from './dto/update-account.dto.js';

@Injectable()
export class AccountsService {
  private readonly freeTrialDays: number;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly configService: ConfigService,
  ) {
    const authConfig = this.configService.get<AuthConfig>('auth');
    if (!authConfig) throw new Error('Auth configuration not loaded');
    this.freeTrialDays = authConfig.freeTrialDays;
  }

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

  async createAccount(userId: string, dto: CreateAccountDto) {
    const isDoctor = dto.roles.includes('DOCTOR');

    const [roles, freePlan] = await Promise.all([
      Promise.all(
        dto.roles.map((name) =>
          this.prismaService.db.role
            .findUnique({ where: { name } })
            .then((r) => {
              if (!r) throw new NotFoundException(`Role '${name}' not found`);
              return r;
            }),
        ),
      ),
      this.prismaService.db.subscriptionPlan.findUnique({
        where: { plan: 'free_trial' },
      }),
    ]);
    if (!freePlan)
      throw new InternalServerErrorException('Free trial plan not seeded');

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + this.freeTrialDays);

    return this.prismaService.db.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          name: dto.account_name,
          specialities: dto.specialties ?? [],
        },
      });
      const branch = await tx.branch.create({
        data: {
          account_id: account.id,
          name: dto.branch_name,
          address: dto.branch_address,
          city: dto.branch_city,
          governorate: dto.branch_governorate,
          country: dto.branch_country,
          is_main: true,
        },
      });
      const profile = await tx.profile.create({
        data: {
          user_id: userId,
          account_id: account.id,
          is_clinical: isDoctor,
          specialty: isDoctor ? (dto.specialty ?? null) : null,
          job_title: isDoctor ? (dto.job_title ?? null) : null,
          roles: {
            create: roles.map((role) => ({ role_id: role.id })),
          },
          branches: {
            create: { branch_id: branch.id, account_id: account.id },
          },
        },
      });
      await tx.subscription.create({
        data: {
          account_id: account.id,
          subscription_plan_id: freePlan.id,
          trial_ends_at: trialEndsAt,
        },
      });
      return {
        account: {
          id: account.id,
          name: account.name,
          specialities: account.specialities,
          status: account.status,
        },
        profile: {
          id: profile.id,
          roles: dto.roles,
          branch: {
            id: branch.id,
            name: branch.name,
            city: branch.city,
            governorate: branch.governorate,
            is_main: branch.is_main,
          },
        },
      };
    });
  }

  async deleteAccount(profileId: string, accountId: string) {
    await this.authorizationService.assertCanManageAccount(
      profileId,
      accountId,
    );
    const account = await this.prismaService.db.account.findFirst({
      where: { id: accountId, is_deleted: false },
    });
    if (!account) throw new NotFoundException('Account not found');

    const now = new Date();
    await this.prismaService.db.$transaction(async (tx) => {
      await tx.branch.updateMany({
        where: { account_id: accountId, is_deleted: false },
        data: { is_deleted: true, deleted_at: now },
      });
      await tx.profile.updateMany({
        where: { account_id: accountId, is_deleted: false },
        data: { is_deleted: true, deleted_at: now },
      });
      await tx.account.update({
        where: { id: accountId },
        data: { is_deleted: true, deleted_at: now },
      });
    });
  }
}
