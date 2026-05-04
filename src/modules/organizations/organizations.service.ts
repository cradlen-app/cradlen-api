import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import type { AuthConfig } from '../../config/auth.config.js';
import type { CreateOrganizationDto } from './dto/create-organization.dto.js';
import type { UpdateOrganizationDto } from './dto/update-organization.dto.js';

@Injectable()
export class OrganizationsService {
  private readonly freeTrialDays: number;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly configService: ConfigService,
  ) {
    const authConfig = this.configService.get<AuthConfig>('auth');
    if (!authConfig) throw new Error('Auth configuration not loaded');
    this.freeTrialDays = authConfig.freeTrialDays;
  }

  async getOrganization(profileId: string, organizationId: string) {
    await this.authorizationService.assertCanManageOrganization(
      profileId,
      organizationId,
    );
    const organization = await this.prismaService.db.organization.findFirst({
      where: { id: organizationId, is_deleted: false },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }

  async updateOrganization(
    profileId: string,
    organizationId: string,
    dto: UpdateOrganizationDto,
  ) {
    await this.authorizationService.assertCanManageOrganization(
      profileId,
      organizationId,
    );
    return this.prismaService.db.organization.update({
      where: { id: organizationId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.specialities !== undefined && {
          specialities: dto.specialities,
        }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  async createOrganization(userId: string, dto: CreateOrganizationDto) {
    await this.subscriptionsService.assertOrganizationLimit(userId);
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
      const organization = await tx.organization.create({
        data: {
          name: dto.organization_name,
          specialities: dto.specialties ?? [],
        },
      });
      const branch = await tx.branch.create({
        data: {
          organization_id: organization.id,
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
          organization_id: organization.id,
          is_clinical: isDoctor,
          specialty: isDoctor ? (dto.specialty ?? null) : null,
          job_title: isDoctor ? (dto.job_title ?? null) : null,
          roles: {
            create: roles.map((role) => ({ role_id: role.id })),
          },
          branches: {
            create: { branch_id: branch.id, organization_id: organization.id },
          },
        },
      });
      await tx.subscription.create({
        data: {
          organization_id: organization.id,
          subscription_plan_id: freePlan.id,
          trial_ends_at: trialEndsAt,
        },
      });
      return {
        organization: {
          id: organization.id,
          name: organization.name,
          specialities: organization.specialities,
          status: organization.status,
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

  async deleteOrganization(profileId: string, organizationId: string) {
    await this.authorizationService.assertCanManageOrganization(
      profileId,
      organizationId,
    );
    const organization = await this.prismaService.db.organization.findFirst({
      where: { id: organizationId, is_deleted: false },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    const now = new Date();
    await this.prismaService.db.$transaction(async (tx) => {
      const profiles = await tx.profile.findMany({
        where: { organization_id: organizationId, is_deleted: false },
        select: { user_id: true },
      });
      const userIds = [...new Set(profiles.map((p) => p.user_id))];

      await tx.branch.updateMany({
        where: { organization_id: organizationId, is_deleted: false },
        data: { is_deleted: true, deleted_at: now },
      });
      await tx.profile.updateMany({
        where: { organization_id: organizationId, is_deleted: false },
        data: { is_deleted: true, deleted_at: now },
      });

      const remainingCounts = await Promise.all(
        userIds.map((userId) =>
          tx.profile.count({
            where: {
              user_id: userId,
              is_deleted: false,
              organization_id: { not: organizationId },
            },
          }),
        ),
      );
      const orphanedUserIds = userIds.filter(
        (_, i) => remainingCounts[i] === 0,
      );

      if (orphanedUserIds.length > 0) {
        await tx.user.updateMany({
          where: { id: { in: orphanedUserIds } },
          data: { is_deleted: true, deleted_at: now, is_active: false },
        });
        await tx.refreshToken.updateMany({
          where: { user_id: { in: orphanedUserIds }, is_revoked: false },
          data: { is_revoked: true },
        });
      }

      await tx.organization.update({
        where: { id: organizationId },
        data: { is_deleted: true, deleted_at: now },
      });
    });
  }
}
