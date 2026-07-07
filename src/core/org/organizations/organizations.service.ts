import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigType } from '@nestjs/config';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { resolveSubspecialties } from '@core/org/staff/staff.assertions.js';
import {
  SpecialtyCatalogService,
  toSpecialtySummary,
} from '@core/org/specialty-catalog/specialty-catalog.public.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { TokensService } from '@core/auth/services/tokens.service.js';
import {
  SessionsService,
  type ProfileSelectionResponse,
} from '@core/auth/services/sessions.service.js';
import authConfig from '@config/auth.config.js';
import type { CreateOrganizationDto } from './dto/create-organization.dto.js';
import type { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import type {
  ConfirmOrganizationImageDto,
  OrganizationImageUploadDto,
  OrganizationImageUploadUrlDto,
} from './dto/organization-image.dto.js';
import { FREE_TRIAL_PLAN, OWNER_ROLE_CODE } from './organizations.constants.js';
import {
  ORGANIZATION_WITH_SPECIALTIES_INCLUDE,
  toOrganizationResponse,
  type OrganizationWithSpecialties,
} from './organizations.mapper.js';
import { provisionOrganization } from './organizations.helpers.js';
import {
  ORGANIZATION_EVENTS,
  type OrganizationCreatedEvent,
  type OrganizationTrialStartedEvent,
} from './organization.events.js';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);
  private readonly freeTrialDays: number;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly specialtiesService: SpecialtyCatalogService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly storageService: StorageService,
    private readonly eventBus: EventBus,
    private readonly tokensService: TokensService,
    private readonly sessionsService: SessionsService,
    @Inject(authConfig.KEY)
    config: ConfigType<typeof authConfig>,
  ) {
    this.freeTrialDays = config.freeTrialDays;
  }

  /** Object-key prefix that scopes a logo to one organization. */
  private logoPrefix(organizationId: string): string {
    return `organizations/${organizationId}/logo/`;
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
    return this.toResponseWithLogo(organization);
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

    return this.toResponseWithLogo(organization);
  }

  /**
   * Issues a short-lived presigned PUT URL for the organization's logo. Images
   * only; the key is server-derived and scoped to the organization. Owners only.
   */
  async createImageUploadUrl(
    profileId: string,
    organizationId: string,
    dto: OrganizationImageUploadDto,
  ): Promise<OrganizationImageUploadUrlDto> {
    await this.authorizationService.assertCanManageOrganization(
      profileId,
      organizationId,
    );
    await this.assertOrganizationExists(organizationId);

    this.assertImageContentType(dto.content_type);
    this.storageService.assertAllowedContentType(dto.content_type);
    this.storageService.assertWithinSizeLimit(dto.size_bytes);

    const ext = this.storageService.extensionFor(dto.content_type);
    const key = `${this.logoPrefix(organizationId)}${randomUUID()}.${ext}`;

    const { url, expiresIn } =
      await this.storageService.createPresignedUploadUrl({
        key,
        contentType: dto.content_type,
      });

    return {
      key,
      upload_url: url,
      expires_in: expiresIn,
      content_type: dto.content_type,
    };
  }

  /**
   * Confirms an uploaded logo: validates the key belongs to this organization
   * and the object actually landed in R2, sets it, and best-effort removes the
   * previously stored logo. Owners only.
   */
  async confirmImage(
    profileId: string,
    organizationId: string,
    dto: ConfirmOrganizationImageDto,
  ) {
    await this.authorizationService.assertCanManageOrganization(
      profileId,
      organizationId,
    );
    const existing = await this.assertOrganizationExists(organizationId);

    if (!dto.key.startsWith(this.logoPrefix(organizationId))) {
      throw new BadRequestException('Invalid image key');
    }

    const head = await this.storageService.headObject(dto.key);
    if (!head) {
      throw new BadRequestException('Uploaded file not found');
    }
    if (head.contentType) {
      this.assertImageContentType(head.contentType);
      this.storageService.assertAllowedContentType(head.contentType);
    }
    if (typeof head.contentLength === 'number') {
      this.storageService.assertWithinSizeLimit(head.contentLength);
    }

    const previousKey = existing.logo_object_key;

    await this.prismaService.db.organization.update({
      where: { id: organizationId },
      data: { logo_object_key: dto.key },
    });

    if (previousKey && previousKey !== dto.key) {
      await this.bestEffortDelete(previousKey);
    }

    return this.loadOrganizationWithLogo(organizationId);
  }

  /** Clears the organization's logo and best-effort removes the R2 object. */
  async removeImage(profileId: string, organizationId: string) {
    await this.authorizationService.assertCanManageOrganization(
      profileId,
      organizationId,
    );
    const existing = await this.assertOrganizationExists(organizationId);
    const previousKey = existing.logo_object_key;

    await this.prismaService.db.organization.update({
      where: { id: organizationId },
      data: { logo_object_key: null },
    });

    if (previousKey) {
      await this.bestEffortDelete(previousKey);
    }

    return this.loadOrganizationWithLogo(organizationId);
  }

  /** Loads a live organization (404 otherwise); returns id + current logo key. */
  private async assertOrganizationExists(organizationId: string) {
    const organization = await this.prismaService.db.organization.findFirst({
      where: { id: organizationId, is_deleted: false },
      select: { id: true, logo_object_key: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }

  private async loadOrganizationWithLogo(organizationId: string) {
    const organization = await this.prismaService.db.organization.findFirst({
      where: { id: organizationId, is_deleted: false },
      include: ORGANIZATION_WITH_SPECIALTIES_INCLUDE,
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return this.toResponseWithLogo(organization);
  }

  /** Maps an organization and attaches a presigned logo GET URL. */
  private async toResponseWithLogo(organization: OrganizationWithSpecialties) {
    const key = organization.logo_object_key;
    const logo_image_url = key
      ? await this.storageService.createPresignedDownloadUrl(key)
      : null;
    return { ...toOrganizationResponse(organization), logo_image_url };
  }

  private assertImageContentType(contentType: string): void {
    if (!contentType.startsWith('image/')) {
      throw new BadRequestException('Organization logo must be an image file');
    }
  }

  private async bestEffortDelete(key: string): Promise<void> {
    try {
      await this.storageService.deleteObject(key);
    } catch {
      this.logger.warn(`Failed to delete previous logo object ${key}`);
    }
  }

  /** Resolves a JobFunction by code, 400ing on an unknown code. */
  private async resolveJobFunction(code: string) {
    const jobFunction = await this.prismaService.db.jobFunction.findUnique({
      where: { code },
    });
    if (!jobFunction) {
      throw new BadRequestException(`Unknown job_function_code: ${code}`);
    }
    return jobFunction;
  }

  async createOrganization(userId: string, dto: CreateOrganizationDto) {
    await this.subscriptionsService.assertOrganizationLimit(userId);

    const specialtyRows = await this.specialtiesService.resolveByCodeOrName(
      dto.specialties ?? [],
      { validate: true },
    );

    // The owner's own job function / specialty / subspecialties — set only when
    // they also practice as a doctor. Mirrors the signup-complete flow so the
    // standalone "create organization" page can offer the same owner fields.
    const jobFunction = dto.job_function_code
      ? await this.resolveJobFunction(dto.job_function_code)
      : null;
    const practitionerSpecialty = dto.practitioner_specialty_code
      ? ((
          await this.specialtiesService.resolveByCodeOrName([
            dto.practitioner_specialty_code,
          ])
        )[0] ?? null)
      : null;
    const practitionerSubspecialties = await resolveSubspecialties(
      this.prismaService,
      dto.practitioner_subspecialty_codes,
      practitionerSpecialty?.id ?? null,
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

    // Trial length is platform-configurable (admin Settings); fall back to the
    // env-seeded default when no settings row exists yet.
    const setting = await this.prismaService.db.platformSetting.findFirst({
      select: { free_trial_days: true },
    });
    const trialDays = setting?.free_trial_days ?? this.freeTrialDays;
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);

    const { organization, branch, profile } =
      await this.prismaService.db.$transaction((tx) =>
        provisionOrganization(tx, {
          userId,
          dto,
          ownerRoleId: ownerRole.id,
          freePlanId: freePlan.id,
          trialEndsAt,
          specialties: specialtyRows,
          owner: {
            executiveTitle: dto.executive_title ?? null,
            professionalTitle: dto.professional_title ?? null,
            engagementType: dto.engagement_type ?? 'FULL_TIME',
            jobFunctionId: jobFunction?.id ?? null,
            practitionerSpecialtyId: practitionerSpecialty?.id ?? null,
            practitionerSubspecialties,
          },
        }),
      );

    // Fan-out for admin notifications / analytics. Best-effort: a subscriber
    // failure cannot fail org creation (see EventBus contract).
    this.eventBus.publish<OrganizationCreatedEvent>(
      ORGANIZATION_EVENTS.created,
      {
        organization_id: organization.id,
        organization_name: organization.name,
      },
    );
    this.eventBus.publish<OrganizationTrialStartedEvent>(
      ORGANIZATION_EVENTS.trialStarted,
      {
        organization_id: organization.id,
        organization_name: organization.name,
        trial_ends_at: trialEndsAt.toISOString(),
      },
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

  /**
   * Create the first organization for a profile-less user, authenticated by the
   * `selection_token` they receive at login (not an access token — they have no
   * profile to mint one from). This is the "removed from all orgs" re-entry
   * path: login returns an empty profile_selection, the FE `/select-profile`
   * empty state offers "Create organization", and that runs here.
   *
   * Restricted to users with ZERO active memberships — a user who still belongs
   * somewhere must add orgs through the authenticated `POST /organizations`
   * route, not this public one. Returns a fresh `profile_selection` (now listing
   * the new org) so the FE can select it and finish signing in.
   */
  async bootstrapOrganizationFromSelectionToken(
    selectionToken: string,
    dto: CreateOrganizationDto,
  ): Promise<ProfileSelectionResponse> {
    const userId = this.tokensService.decodeSignupToken(
      selectionToken,
      'profile_selection',
    );
    const activeMemberships = await this.prismaService.db.profile.count({
      where: {
        user_id: userId,
        is_deleted: false,
        is_active: true,
        organization: { is_deleted: false, status: 'ACTIVE' },
      },
    });
    if (activeMemberships > 0) {
      throw new ForbiddenException(
        'Sign in to an existing organization to create another one',
      );
    }
    await this.createOrganization(userId, dto);
    return this.sessionsService.buildProfileSelectionResponse(userId);
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
