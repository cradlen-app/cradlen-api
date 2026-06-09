import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ServiceType } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { paginated } from '@common/utils/pagination.utils.js';
import type { CreateServiceDto } from './dto/create-service.dto.js';
import type { UpdateServiceDto } from './dto/update-service.dto.js';
import type { ServiceResponseDto } from './dto/service-response.dto.js';

type ServiceWithSpecialties = Prisma.ServiceGetPayload<{
  include: { specialties: true; category: true };
}>;

const SERVICE_INCLUDE = {
  specialties: true,
  category: true,
} satisfies Prisma.ServiceInclude;

/**
 * Billable-service catalog. Holds the org-scoped (and system-wide) `Service`
 * rows that pricing, charging and invoicing reference.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async findAll(
    organizationId: string,
    filters: {
      service_type?: ServiceType;
      specialty_id?: string;
      category_id?: string;
      active?: boolean;
    },
    page = 1,
    limit = 20,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      organizationId,
    );

    const where: Prisma.ServiceWhereInput = {
      is_deleted: false,
      OR: [{ organization_id: organizationId }, { organization_id: null }],
      ...(filters.service_type && { service_type: filters.service_type }),
      ...(filters.active !== undefined && { is_active: filters.active }),
      ...(filters.category_id && { category_id: filters.category_id }),
      ...(filters.specialty_id && {
        specialties: { some: { specialty_id: filters.specialty_id } },
      }),
    };

    const [items, total] = await Promise.all([
      this.prismaService.db.service.findMany({
        where,
        include: SERVICE_INCLUDE,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prismaService.db.service.count({ where }),
    ]);

    return paginated(
      items.map((service) => this.toDto(service)),
      { page, limit, total },
    );
  }

  async getOne(
    organizationId: string,
    serviceId: string,
    user: AuthContext,
  ): Promise<ServiceResponseDto> {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      organizationId,
    );

    const service = await this.prismaService.db.service.findFirst({
      where: {
        id: serviceId,
        OR: [{ organization_id: organizationId }, { organization_id: null }],
        is_deleted: false,
      },
      include: SERVICE_INCLUDE,
    });
    if (!service) throw new NotFoundException('Service not found');
    return this.toDto(service);
  }

  async create(
    organizationId: string,
    dto: CreateServiceDto,
    user: AuthContext,
  ): Promise<ServiceResponseDto> {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );

    const existing = await this.prismaService.db.service.findFirst({
      where: {
        organization_id: organizationId,
        code: dto.code,
        is_deleted: false,
      },
    });
    if (existing) {
      throw new ConflictException(
        'Service code already exists in this organization',
      );
    }

    if (dto.category_id) {
      await this.assertCategoryValid(organizationId, dto.category_id);
    }

    const created = await this.prismaService.db.service.create({
      data: {
        organization_id: organizationId,
        category_id: dto.category_id,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        service_type: dto.service_type,
        duration_minutes: dto.duration_minutes,
        billing_code: dto.billing_code,
        unit: dto.unit,
        created_by_id: user.profileId,
        specialties: dto.specialty_ids?.length
          ? { create: dto.specialty_ids.map((id) => ({ specialty_id: id })) }
          : undefined,
      },
      include: SERVICE_INCLUDE,
    });
    return this.toDto(created);
  }

  async update(
    organizationId: string,
    serviceId: string,
    dto: UpdateServiceDto,
    user: AuthContext,
  ): Promise<ServiceResponseDto> {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );
    await this.findOwnedOrThrow(organizationId, serviceId);

    if (dto.category_id) {
      await this.assertCategoryValid(organizationId, dto.category_id);
    }

    const updated = await this.prismaService.db.$transaction(async (tx) => {
      if (dto.specialty_ids !== undefined) {
        await tx.serviceSpecialty.deleteMany({
          where: { service_id: serviceId },
        });
        if (dto.specialty_ids.length) {
          await tx.serviceSpecialty.createMany({
            data: dto.specialty_ids.map((id) => ({
              service_id: serviceId,
              specialty_id: id,
            })),
          });
        }
      }
      return tx.service.update({
        where: { id: serviceId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(dto.service_type !== undefined && {
            service_type: dto.service_type,
          }),
          ...(dto.code !== undefined && { code: dto.code }),
          ...(dto.category_id !== undefined && {
            category_id: dto.category_id,
          }),
          ...(dto.duration_minutes !== undefined && {
            duration_minutes: dto.duration_minutes,
          }),
          ...(dto.billing_code !== undefined && {
            billing_code: dto.billing_code,
          }),
          ...(dto.unit !== undefined && { unit: dto.unit }),
        },
        include: SERVICE_INCLUDE,
      });
    });
    return this.toDto(updated);
  }

  async activate(
    organizationId: string,
    serviceId: string,
    user: AuthContext,
  ): Promise<ServiceResponseDto> {
    return this.setActive(organizationId, serviceId, true, user);
  }

  async deactivate(
    organizationId: string,
    serviceId: string,
    user: AuthContext,
  ): Promise<ServiceResponseDto> {
    return this.setActive(organizationId, serviceId, false, user);
  }

  private async setActive(
    organizationId: string,
    serviceId: string,
    isActive: boolean,
    user: AuthContext,
  ): Promise<ServiceResponseDto> {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );
    await this.findOwnedOrThrow(organizationId, serviceId);
    const updated = await this.prismaService.db.service.update({
      where: { id: serviceId },
      data: { is_active: isActive },
      include: SERVICE_INCLUDE,
    });
    return this.toDto(updated);
  }

  async remove(
    organizationId: string,
    serviceId: string,
    user: AuthContext,
  ): Promise<void> {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );
    await this.findOwnedOrThrow(organizationId, serviceId);
    await this.prismaService.db.service.update({
      where: { id: serviceId },
      data: { is_deleted: true, deleted_at: new Date(), is_active: false },
    });
  }

  private async findOwnedOrThrow(organizationId: string, serviceId: string) {
    const service = await this.prismaService.db.service.findFirst({
      where: {
        id: serviceId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!service) throw new NotFoundException('Service not found');
    return service;
  }

  /** A service may reference an org-owned or a system-wide (null org) category. */
  private async assertCategoryValid(
    organizationId: string,
    categoryId: string,
  ): Promise<void> {
    const category = await this.prismaService.db.serviceCategory.findFirst({
      where: {
        id: categoryId,
        OR: [{ organization_id: organizationId }, { organization_id: null }],
        is_deleted: false,
      },
      select: { id: true },
    });
    if (!category) {
      throw new BadRequestException('Service category not found');
    }
  }

  private toDto(service: ServiceWithSpecialties): ServiceResponseDto {
    return {
      id: service.id,
      organization_id: service.organization_id,
      code: service.code,
      name: service.name,
      description: service.description,
      service_type: service.service_type,
      category_id: service.category_id,
      category: service.category
        ? {
            id: service.category.id,
            code: service.category.code,
            name: service.category.name,
          }
        : null,
      duration_minutes: service.duration_minutes,
      billing_code: service.billing_code,
      unit: service.unit,
      is_active: service.is_active,
      specialty_ids: service.specialties.map((s) => s.specialty_id),
      created_at: service.created_at,
      updated_at: service.updated_at,
    };
  }
}
