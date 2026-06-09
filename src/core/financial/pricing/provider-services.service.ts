import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { DEFAULT_CURRENCY } from '../shared/currency.js';
import type { CreateProviderServiceDto } from './dto/create-provider-service.dto.js';
import type { CreateProviderPriceOverrideDto } from './dto/create-provider-price-override.dto.js';
import type { UpdateProviderPriceOverrideDto } from './dto/update-provider-price-override.dto.js';

@Injectable()
export class ProviderServicesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async findProviderServices(
    organizationId: string,
    profileId: string,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      organizationId,
    );
    return this.prismaService.db.providerService.findMany({
      where: {
        organization_id: organizationId,
        profile_id: profileId,
        is_deleted: false,
      },
      include: {
        service: {
          select: { id: true, name: true, code: true, service_type: true },
        },
      },
    });
  }

  async authorizeService(
    organizationId: string,
    profileId: string,
    dto: CreateProviderServiceDto,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanManageStaff(
      user.profileId,
      organizationId,
    );
    await this.assertProfileInOrg(organizationId, profileId);
    await this.assertServiceExists(organizationId, dto.service_id);

    const existing = await this.prismaService.db.providerService.findFirst({
      where: {
        organization_id: organizationId,
        profile_id: profileId,
        service_id: dto.service_id,
        branch_id: dto.branch_id ?? null,
        is_deleted: false,
      },
    });
    if (existing) {
      throw new ConflictException(
        'Provider is already authorized for this service',
      );
    }

    return this.prismaService.db.providerService.create({
      data: {
        organization_id: organizationId,
        profile_id: profileId,
        service_id: dto.service_id,
        branch_id: dto.branch_id ?? null,
        duration_minutes: dto.duration_minutes ?? null,
        created_by_id: user.profileId,
      },
      include: {
        service: {
          select: { id: true, name: true, code: true, service_type: true },
        },
      },
    });
  }

  async revokeService(
    organizationId: string,
    profileId: string,
    serviceId: string,
    user: AuthContext,
  ): Promise<void> {
    await this.authorizationService.assertCanManageStaff(
      user.profileId,
      organizationId,
    );

    const record = await this.prismaService.db.providerService.findFirst({
      where: {
        organization_id: organizationId,
        profile_id: profileId,
        service_id: serviceId,
        is_deleted: false,
      },
    });
    if (!record) throw new NotFoundException('Provider service not found');

    await this.prismaService.db.providerService.updateMany({
      where: {
        organization_id: organizationId,
        profile_id: profileId,
        service_id: serviceId,
        is_deleted: false,
      },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  async findPriceOverrides(
    organizationId: string,
    profileId: string,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      organizationId,
    );
    return this.prismaService.db.providerPriceOverride.findMany({
      where: {
        organization_id: organizationId,
        profile_id: profileId,
        is_deleted: false,
      },
      include: {
        service: {
          select: { id: true, name: true, code: true, service_type: true },
        },
      },
    });
  }

  async createPriceOverride(
    organizationId: string,
    profileId: string,
    dto: CreateProviderPriceOverrideDto,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanManageStaff(
      user.profileId,
      organizationId,
    );
    await this.assertProfileInOrg(organizationId, profileId);
    await this.assertServiceExists(organizationId, dto.service_id);
    this.assertValidDates(dto.valid_from, dto.valid_to);
    // Can't price a service the provider isn't authorized for.
    await this.assertProviderAuthorized(
      organizationId,
      profileId,
      dto.service_id,
      dto.branch_id ?? null,
    );

    const existing =
      await this.prismaService.db.providerPriceOverride.findFirst({
        where: {
          organization_id: organizationId,
          profile_id: profileId,
          service_id: dto.service_id,
          branch_id: dto.branch_id ?? null,
          is_deleted: false,
        },
      });
    if (existing)
      throw new ConflictException(
        'An active price override already exists for this provider/service/branch combination',
      );

    return this.prismaService.db.providerPriceOverride.create({
      data: {
        organization_id: organizationId,
        profile_id: profileId,
        service_id: dto.service_id,
        branch_id: dto.branch_id ?? null,
        price: dto.price,
        currency: dto.currency ?? DEFAULT_CURRENCY,
        valid_from: dto.valid_from ? new Date(dto.valid_from) : null,
        valid_to: dto.valid_to ? new Date(dto.valid_to) : null,
        created_by_id: user.profileId,
      },
      include: {
        service: {
          select: { id: true, name: true, code: true, service_type: true },
        },
      },
    });
  }

  async updatePriceOverride(
    organizationId: string,
    profileId: string,
    overrideId: string,
    dto: UpdateProviderPriceOverrideDto,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanManageStaff(
      user.profileId,
      organizationId,
    );

    const override =
      await this.prismaService.db.providerPriceOverride.findFirst({
        where: {
          id: overrideId,
          organization_id: organizationId,
          profile_id: profileId,
          is_deleted: false,
        },
      });
    if (!override) throw new NotFoundException('Price override not found');
    this.assertValidDates(dto.valid_from, dto.valid_to);

    return this.prismaService.db.providerPriceOverride.update({
      where: { id: overrideId },
      data: {
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.valid_from !== undefined && {
          valid_from: dto.valid_from ? new Date(dto.valid_from) : null,
        }),
        ...(dto.valid_to !== undefined && {
          valid_to: dto.valid_to ? new Date(dto.valid_to) : null,
        }),
      },
      include: {
        service: {
          select: { id: true, name: true, code: true, service_type: true },
        },
      },
    });
  }

  async removePriceOverride(
    organizationId: string,
    profileId: string,
    overrideId: string,
    user: AuthContext,
  ): Promise<void> {
    await this.authorizationService.assertCanManageStaff(
      user.profileId,
      organizationId,
    );

    const override =
      await this.prismaService.db.providerPriceOverride.findFirst({
        where: {
          id: overrideId,
          organization_id: organizationId,
          profile_id: profileId,
          is_deleted: false,
        },
      });
    if (!override) throw new NotFoundException('Price override not found');

    await this.prismaService.db.providerPriceOverride.update({
      where: { id: overrideId },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  // ---------- GET single ----------

  async getProviderService(
    organizationId: string,
    profileId: string,
    serviceId: string,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      organizationId,
    );
    const record = await this.prismaService.db.providerService.findFirst({
      where: {
        organization_id: organizationId,
        profile_id: profileId,
        service_id: serviceId,
        is_deleted: false,
      },
      include: {
        service: {
          select: { id: true, name: true, code: true, service_type: true },
        },
      },
    });
    if (!record) throw new NotFoundException('Provider service not found');
    return record;
  }

  async getPriceOverride(
    organizationId: string,
    profileId: string,
    overrideId: string,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      organizationId,
    );
    const override =
      await this.prismaService.db.providerPriceOverride.findFirst({
        where: {
          id: overrideId,
          organization_id: organizationId,
          profile_id: profileId,
          is_deleted: false,
        },
        include: {
          service: {
            select: { id: true, name: true, code: true, service_type: true },
          },
        },
      });
    if (!override) throw new NotFoundException('Price override not found');
    return override;
  }

  // ---------- Activate / deactivate ----------

  async setServiceActive(
    organizationId: string,
    profileId: string,
    serviceId: string,
    isActive: boolean,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanManageStaff(
      user.profileId,
      organizationId,
    );
    const record = await this.prismaService.db.providerService.findFirst({
      where: {
        organization_id: organizationId,
        profile_id: profileId,
        service_id: serviceId,
        is_deleted: false,
      },
    });
    if (!record) throw new NotFoundException('Provider service not found');
    return this.prismaService.db.providerService.update({
      where: { id: record.id },
      data: { is_active: isActive },
      include: {
        service: {
          select: { id: true, name: true, code: true, service_type: true },
        },
      },
    });
  }

  async setOverrideActive(
    organizationId: string,
    profileId: string,
    overrideId: string,
    isActive: boolean,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanManageStaff(
      user.profileId,
      organizationId,
    );
    const override =
      await this.prismaService.db.providerPriceOverride.findFirst({
        where: {
          id: overrideId,
          organization_id: organizationId,
          profile_id: profileId,
          is_deleted: false,
        },
      });
    if (!override) throw new NotFoundException('Price override not found');
    return this.prismaService.db.providerPriceOverride.update({
      where: { id: overrideId },
      data: { is_active: isActive },
      include: {
        service: {
          select: { id: true, name: true, code: true, service_type: true },
        },
      },
    });
  }

  // ---------- Validation helpers ----------

  private async assertProfileInOrg(
    organizationId: string,
    profileId: string,
  ): Promise<void> {
    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        id: profileId,
        organization_id: organizationId,
        is_deleted: false,
      },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException(
        'Provider profile not found in this organization',
      );
    }
  }

  private async assertServiceExists(
    organizationId: string,
    serviceId: string,
  ): Promise<void> {
    const service = await this.prismaService.db.service.findFirst({
      where: {
        id: serviceId,
        OR: [{ organization_id: organizationId }, { organization_id: null }],
        is_deleted: false,
      },
      select: { id: true },
    });
    if (!service) throw new BadRequestException('Service not found');
  }

  private assertValidDates(from?: string, to?: string): void {
    if (from && to && new Date(from) >= new Date(to)) {
      throw new BadRequestException('valid_from must be before valid_to');
    }
  }

  /** The provider must be authorized (active ProviderService) at this branch or org-wide. */
  private async assertProviderAuthorized(
    organizationId: string,
    profileId: string,
    serviceId: string,
    branchId: string | null,
  ): Promise<void> {
    const authorized = await this.prismaService.db.providerService.findFirst({
      where: {
        organization_id: organizationId,
        profile_id: profileId,
        service_id: serviceId,
        is_active: true,
        is_deleted: false,
        OR: [{ branch_id: branchId }, { branch_id: null }],
      },
      select: { id: true },
    });
    if (!authorized) {
      throw new BadRequestException(
        'Provider is not authorized for this service; authorize the service first',
      );
    }
  }
}
