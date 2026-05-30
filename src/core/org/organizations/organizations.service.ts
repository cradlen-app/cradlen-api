import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import {
  SpecialtiesService,
  toSpecialtySummary,
} from '@core/org/specialties/specialties.public.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import authConfig from '@config/auth.config.js';
import type { CreateOrganizationDto } from './dto/create-organization.dto.js';
import type { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { FREE_TRIAL_PLAN, OWNER_ROLE_CODE } from './organizations.constants.js';
import {
  ORGANIZATION_WITH_SPECIALTIES_INCLUDE,
  toOrganizationResponse,
} from './organizations.mapper.js';
import { provisionOrganization } from './organizations.helpers.js';

@Injectable()
export class OrganizationsService {
  private readonly freeTrialDays: number;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly specialtiesService: SpecialtiesService,
    private readonly subscriptionsService: SubscriptionsService,
    @Inject(authConfig.KEY)
    config: ConfigType<typeof authConfig>,
  ) {
    this.freeTrialDays = config.freeTrialDays;
  }

  async listOrganizationSpecialties(profileId: string, organizationId: string) {
    await this.authorizationService.assertCanAccessOrganization(
      profileId,
      organizationId,
    );

    const links = await this.prismaService.db.organizationSpecialty.findMany({
      where: {
        organization_id: organizationId,
        specialty: { is_deleted: false },
      },
      include: { specialty: true },
      orderBy: { specialty: { name: 'asc' } },
    });

    return links.map((l) => toSpecialtySummary(l.specialty));
  }

  async getOrganization(profileId: string, organizationId: string) {
    await this.authorizationService.assertCanAccessOrganization(
      profileId,
      organizationId,
    );
    const organization = await this.prismaService.db.organization.findFirst({
      where: { id: organizationId, is_deleted: false },
      include: ORGANIZATION_WITH_SPECIALTIES_INCLUDE,
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return toOrganizationResponse(organization);
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

    const organization = await this.prismaService.db.$transaction(
      async (tx) => {
        // Resolve inside the tx so the specialty set can't be soft-deleted
        // between validation and the link rewrite.
        const specialtyRows =
          dto.specialties !== undefined
            ? await this.specialtiesService.resolveByCodeOrName(
                dto.specialties,
                { validate: true },
                tx,
              )
            : [];

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
          // Replace the whole set: drop existing links, recreate from the
          // resolved rows. Simpler than diffing and the set is small.
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
          include: ORGANIZATION_WITH_SPECIALTIES_INCLUDE,
        });
        if (!refreshed) throw new NotFoundException('Organization not found');
        return refreshed;
      },
    );

    return toOrganizationResponse(organization);
  }

  async createOrganization(userId: string, dto: CreateOrganizationDto) {
    await this.subscriptionsService.assertOrganizationLimit(userId);

    const specialtyRows = await this.specialtiesService.resolveByCodeOrName(
      dto.specialties ?? [],
      { validate: true },
    );

    const [ownerRole, freePlan] = await Promise.all([
      this.prismaService.db.role.findUnique({
        where: { code: OWNER_ROLE_CODE },
      }),
      this.prismaService.db.subscriptionPlan.findUnique({
        where: { plan: FREE_TRIAL_PLAN },
      }),
    ]);
    if (!ownerRole)
      throw new InternalServerErrorException(
        `${OWNER_ROLE_CODE} role not seeded`,
      );
    if (!freePlan)
      throw new InternalServerErrorException('Free trial plan not seeded');

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + this.freeTrialDays);

    const { organization, branch, profile } =
      await this.prismaService.db.$transaction((tx) =>
        provisionOrganization(tx, {
          userId,
          dto,
          ownerRoleId: ownerRole.id,
          freePlanId: freePlan.id,
          trialEndsAt,
          specialties: specialtyRows,
        }),
      );

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        specialties: specialtyRows.map(toSpecialtySummary),
        status: organization.status,
      },
      profile: {
        id: profile.id,
        roles: [OWNER_ROLE_CODE],
        branch: {
          id: branch.id,
          name: branch.name,
          city: branch.city,
          governorate: branch.governorate,
          is_main: branch.is_main,
        },
      },
    };
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

      // Org-scoped dependents that must not outlive the organization.
      await tx.subscription.updateMany({
        where: { organization_id: organizationId, is_deleted: false },
        data: { is_deleted: true, deleted_at: now, status: 'CANCELLED' },
      });
      // Cancel still-actionable invitations so their tokens can't be redeemed
      // into a deleted org.
      await tx.invitation.updateMany({
        where: {
          organization_id: organizationId,
          status: 'PENDING',
          is_deleted: false,
        },
        data: { is_deleted: true, deleted_at: now, status: 'CANCELLED' },
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
      }

      // Revoke every token scoped to this org (so members who keep a profile
      // elsewhere can't keep hitting deleted-org data) plus all tokens of
      // now-orphaned users.
      await tx.refreshToken.updateMany({
        where: {
          is_revoked: false,
          OR: [
            { organization_id: organizationId },
            ...(orphanedUserIds.length
              ? [{ user_id: { in: orphanedUserIds } }]
              : []),
          ],
        },
        data: { is_revoked: true, revoked_at: now },
      });

      await tx.organization.update({
        where: { id: organizationId },
        data: { is_deleted: true, deleted_at: now },
      });
    });

    // NOTE: OrganizationSpecialty join rows and terminal-state invitations are
    // intentionally retained — the org is soft-deleted, queries filter by org,
    // and retention keeps a restore path open.
  }
}
