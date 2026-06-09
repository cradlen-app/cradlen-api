import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ServiceCategory } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { paginated } from '@common/utils/pagination.utils.js';
import type { CreateServiceCategoryDto } from './dto/create-service-category.dto.js';
import type { UpdateServiceCategoryDto } from './dto/update-service-category.dto.js';
import type { ServiceCategoryResponseDto } from './dto/service-category-response.dto.js';

/**
 * Service categories — a managed, org-scoped (plus system-wide) grouping list
 * for the billable-service catalog. Purely organizational; carries no pricing.
 */
@Injectable()
export class CatalogCategoryService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async findAll(
    organizationId: string,
    filters: { active?: boolean },
    page = 1,
    limit = 20,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      organizationId,
    );

    const where: Prisma.ServiceCategoryWhereInput = {
      is_deleted: false,
      OR: [{ organization_id: organizationId }, { organization_id: null }],
      ...(filters.active !== undefined && { is_active: filters.active }),
    };

    const [items, total] = await Promise.all([
      this.prismaService.db.serviceCategory.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prismaService.db.serviceCategory.count({ where }),
    ]);

    return paginated(
      items.map((category) => this.toDto(category)),
      { page, limit, total },
    );
  }

  async create(
    organizationId: string,
    dto: CreateServiceCategoryDto,
    user: AuthContext,
  ): Promise<ServiceCategoryResponseDto> {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );

    const existing = await this.prismaService.db.serviceCategory.findFirst({
      where: {
        organization_id: organizationId,
        code: dto.code,
        is_deleted: false,
      },
    });
    if (existing) {
      throw new ConflictException(
        'Category code already exists in this organization',
      );
    }

    const created = await this.prismaService.db.serviceCategory.create({
      data: {
        organization_id: organizationId,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        created_by_id: user.profileId,
      },
    });
    return this.toDto(created);
  }

  async update(
    organizationId: string,
    categoryId: string,
    dto: UpdateServiceCategoryDto,
    user: AuthContext,
  ): Promise<ServiceCategoryResponseDto> {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );
    await this.findOwnedOrThrow(organizationId, categoryId);

    const updated = await this.prismaService.db.serviceCategory.update({
      where: { id: categoryId },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      },
    });
    return this.toDto(updated);
  }

  async remove(
    organizationId: string,
    categoryId: string,
    user: AuthContext,
  ): Promise<void> {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      organizationId,
    );
    await this.findOwnedOrThrow(organizationId, categoryId);
    await this.prismaService.db.serviceCategory.update({
      where: { id: categoryId },
      data: { is_deleted: true, deleted_at: new Date(), is_active: false },
    });
  }

  private async findOwnedOrThrow(organizationId: string, categoryId: string) {
    const category = await this.prismaService.db.serviceCategory.findFirst({
      where: {
        id: categoryId,
        organization_id: organizationId,
        is_deleted: false,
      },
    });
    if (!category) throw new NotFoundException('Service category not found');
    return category;
  }

  private toDto(category: ServiceCategory): ServiceCategoryResponseDto {
    return {
      id: category.id,
      organization_id: category.organization_id,
      code: category.code,
      name: category.name,
      description: category.description,
      is_active: category.is_active,
      created_at: category.created_at,
      updated_at: category.updated_at,
    };
  }
}
