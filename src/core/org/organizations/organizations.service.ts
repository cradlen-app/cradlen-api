import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import type { AuthConfig } from '@config/auth.config.js';
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
      include: { specialty_links: { include: { specialty: true } } },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    const { specialty_links, ...rest } = organization;
    return {
      ...rest,
      specialties: specialty_links.map((l) => ({
        id: l.specialty.id,
        code: l.specialty.code,
        name: l.specialty.name,
      })),
    };
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

    const specialtyRows = dto.specialties?.length
      ? await this.prismaService.db.specialty.findMany({
          where: {
            OR: [
              { code: { in: dto.specialties } },
              { name: { in: dto.specialties, mode: 'insensitive' } },
            ],
            is_deleted: false,
          },
        })
      : [];

    const organization = await this.prismaService.db.$transaction(
      async (tx) => {
        if (dto.name !== undefined || dto.status !== undefined) {
          await tx.organization.update({
            where: { id: organizationId },
            data: {
              ...(dto.name !== undefined && { name: dto.name }),
              ...(dto.status !== undefined && { status: dto.status }),
            },
          });
        }

        if (dto.specialties !== undefined) {
          await tx.organizationSpecialty.deleteMany({
            where: { organization_id: organizationId },
          });
          if (specialtyRows.length) {
            await tx.organizationSpecialty.createMany({
              data: specialtyRows.map((s) => ({
                organization_id: organizationId,
                specialty_id: s.id,
              })),
              skipDuplicates: true,
            });
          }
        }

        const refreshed = await tx.organization.findFirst({
          where: { id: organizationId, is_deleted: false },
          include: { specialty_links: { include: { specialty: true } } },
        });
        if (!refreshed) throw new NotFoundException('Organization not found');
        return refreshed;
      },
    );

    const { specialty_links, ...rest } = organization;
    return {
      ...rest,
      specialties: specialty_links.map((l) => ({
        id: l.specialty.id,
        code: l.specialty.code,
        name: l.specialty.name,
      })),
    };
  }

  async createOrganization(userId: string, dto: CreateOrganizationDto) {
    await this.subscriptionsService.assertOrganizationLimit(userId);

    // Resolve specialties by code (silent skip on miss).
    const specialtyRows = dto.specialties?.length
      ? await this.prismaService.db.specialty.findMany({
          where: {
            OR: [
              { code: { in: dto.specialties } },
              { name: { in: dto.specialties, mode: 'insensitive' } },
            ],
            is_deleted: false,
          },
        })
      : [];

    const [ownerRole, freePlan] = await Promise.all([
      this.prismaService.db.role
        .findUnique({ where: { name: 'OWNER' } })
        .then((r) => {
          if (!r) throw new NotFoundException("Role 'OWNER' not found");
          return r;
        }),
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
          specialty_links: specialtyRows.length
            ? {
                create: specialtyRows.map((s) => ({ specialty_id: s.id })),
              }
            : undefined,
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
          roles: { create: [{ role_id: ownerRole.id }] },
          branches: {
            create: { branch_id: branch.id, organization_id: organization.id },
          },
          specialty_links: specialtyRows.length
            ? {
                create: specialtyRows.map((s) => ({ specialty_id: s.id })),
              }
            : undefined,
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
          specialties: specialtyRows.map((s) => ({
            id: s.id,
            code: s.code,
            name: s.name,
          })),
          status: organization.status,
        },
        profile: {
          id: profile.id,
          roles: ['OWNER'],
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
