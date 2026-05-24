import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ServiceType } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { paginated } from '@common/utils/pagination.utils.js';
import type { CreateServiceDto } from './dto/create-service.dto.js';
import type { UpdateServiceDto } from './dto/update-service.dto.js';

@Injectable()
export class ServicesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async findAll(
    organizationId: string,
    filters: {
      service_type?: ServiceType;
      specialty_id?: string;
      active?: boolean;
    },
    page = 1,
    limit = 20,
  ) {
    const where = {
      is_deleted: false,
      OR: [{ organization_id: organizationId }, { organization_id: null }],
      ...(filters.service_type && { service_type: filters.service_type }),
      ...(filters.active !== undefined && { is_active: filters.active }),
      ...(filters.specialty_id && {
        specialties: { some: { specialty_id: filters.specialty_id } },
      }),
    };

    const [items, total] = await Promise.all([
      this.prismaService.db.service.findMany({
        where,
        include: { specialties: true },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prismaService.db.service.count({ where }),
    ]);

    return paginated(
      items.map((s) => this.toDto(s)),
      { page, limit, total },
    );
  }

  async create(organizationId: string, dto: CreateServiceDto, user: AuthContext) {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );

    const existing = await this.prismaService.db.service.findFirst({
      where: { organization_id: organizationId, code: dto.code, is_deleted: false },
    });
    if (existing) {
      throw new ConflictException('Service code already exists in this organization');
    }

    const created = await this.prismaService.db.service.create({
      data: {
        organization_id: organizationId,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        service_type: dto.service_type,
        created_by_id: user.profileId,
        specialties: dto.specialty_ids?.length
          ? { create: dto.specialty_ids.map((id) => ({ specialty_id: id })) }
          : undefined,
      },
      include: { specialties: true },
    });
    return this.toDto(created);
  }

  async update(
    organizationId: string,
    serviceId: string,
    dto: UpdateServiceDto,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );
    await this.findOwnedOrThrow(organizationId, serviceId);

    const updated = await this.prismaService.db.$transaction(async (tx) => {
      if (dto.specialty_ids !== undefined) {
        await tx.serviceSpecialty.deleteMany({ where: { service_id: serviceId } });
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
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.service_type !== undefined && { service_type: dto.service_type }),
          ...(dto.code !== undefined && { code: dto.code }),
        },
        include: { specialties: true },
      });
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
      where: { id: serviceId, organization_id: organizationId, is_deleted: false },
    });
    if (!service) throw new NotFoundException('Service not found');
    return service;
  }

  // Kept for any future internal use that intentionally includes system-wide services.
  private async findOneOrThrow(organizationId: string, serviceId: string) {
    const service = await this.prismaService.db.service.findFirst({
      where: {
        id: serviceId,
        OR: [{ organization_id: organizationId }, { organization_id: null }],
        is_deleted: false,
      },
    });
    if (!service) throw new NotFoundException('Service not found');
    return service;
  }

  private toDto(service: any & { specialties: { specialty_id: string }[] }) {
    return { ...service, specialty_ids: service.specialties.map((s: any) => s.specialty_id) };
  }
}
