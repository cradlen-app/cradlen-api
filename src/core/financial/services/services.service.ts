import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
      service_type?: string;
      specialty_id?: string;
      active?: boolean;
    },
    page = 1,
    limit = 20,
  ) {
    const where = {
      is_deleted: false,
      OR: [{ organization_id: organizationId }, { organization_id: null }],
      ...(filters.service_type && {
        service_type: filters.service_type as any,
      }),
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
      items.map((s) => ({
        ...s,
        specialty_ids: s.specialties.map((ss) => ss.specialty_id),
      })),
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

    return this.prismaService.db.service.create({
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
    await this.findOneOrThrow(organizationId, serviceId);

    return this.prismaService.db.$transaction(async (tx) => {
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
  }

  async remove(
    organizationId: string,
    serviceId: string,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );
    await this.findOneOrThrow(organizationId, serviceId);
    await this.prismaService.db.service.update({
      where: { id: serviceId },
      data: { is_deleted: true, deleted_at: new Date(), is_active: false },
    });
  }

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
}
