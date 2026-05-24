import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import type { CreateProviderServiceDto } from './dto/create-provider-service.dto.js';
import type { CreateProviderPriceOverrideDto } from './dto/create-provider-price-override.dto.js';
import type { UpdateProviderPriceOverrideDto } from './dto/update-provider-price-override.dto.js';

@Injectable()
export class ProviderServicesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async findProviderServices(organizationId: string, profileId: string) {
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

    const existing = await this.prismaService.db.providerService.findFirst({
      where: {
        organization_id: organizationId,
        profile_id: profileId,
        service_id: dto.service_id,
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
        duration_minutes: dto.duration ?? null,
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

  async findPriceOverrides(organizationId: string, profileId: string) {
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

    return this.prismaService.db.providerPriceOverride.create({
      data: {
        organization_id: organizationId,
        profile_id: profileId,
        service_id: dto.service_id,
        branch_id: dto.branch_id ?? null,
        price: dto.price,
        currency: dto.currency ?? 'EGP',
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
}
