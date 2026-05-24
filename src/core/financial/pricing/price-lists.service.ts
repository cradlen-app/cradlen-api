import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { paginated } from '@common/utils/pagination.utils.js';
import type { CreatePriceListDto } from './dto/create-price-list.dto.js';
import type { CreatePriceListItemDto } from './dto/create-price-list-item.dto.js';
import type { UpdatePriceListItemDto } from './dto/update-price-list-item.dto.js';

@Injectable()
export class PriceListsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async findAll(
    organizationId: string,
    branchId: string | undefined,
    page = 1,
    limit = 20,
  ) {
    const where = {
      organization_id: organizationId,
      is_deleted: false,
      ...(branchId !== undefined && { branch_id: branchId }),
    };

    const [items, total] = await Promise.all([
      this.prismaService.db.priceList.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prismaService.db.priceList.count({ where }),
    ]);

    return paginated(items, { page, limit, total });
  }

  async create(
    organizationId: string,
    dto: CreatePriceListDto,
    user: AuthContext,
  ) {
    await this.assertCanManageList(user, organizationId, dto.branch_id);

    if (dto.is_default) {
      const existingDefault = await this.prismaService.db.priceList.findFirst({
        where: {
          organization_id: organizationId,
          branch_id: dto.branch_id ?? null,
          is_default: true,
          is_deleted: false,
        },
      });
      if (existingDefault) {
        throw new ConflictException(
          'A default price list already exists for this scope',
        );
      }
    }

    return this.prismaService.db.priceList.create({
      data: {
        organization_id: organizationId,
        branch_id: dto.branch_id ?? null,
        name: dto.name,
        currency: dto.currency ?? 'EGP',
        is_default: dto.is_default ?? false,
        valid_from: dto.valid_from ? new Date(dto.valid_from) : null,
        valid_to: dto.valid_to ? new Date(dto.valid_to) : null,
        created_by_id: user.profileId,
      },
    });
  }

  async findItems(organizationId: string, priceListId: string) {
    await this.findListOrThrow(organizationId, priceListId);

    return this.prismaService.db.priceListItem.findMany({
      where: { price_list_id: priceListId, is_deleted: false },
      include: {
        service: { select: { id: true, name: true, code: true, service_type: true } },
      },
    });
  }

  async addItem(
    organizationId: string,
    priceListId: string,
    dto: CreatePriceListItemDto,
    user: AuthContext,
  ) {
    const list = await this.findListOrThrow(organizationId, priceListId);
    await this.assertCanManageList(user, organizationId, list.branch_id ?? undefined);

    const duplicate = await this.prismaService.db.priceListItem.findFirst({
      where: { price_list_id: priceListId, service_id: dto.service_id, is_deleted: false },
    });
    if (duplicate) {
      throw new ConflictException('Service already exists in this price list');
    }

    return this.prismaService.db.priceListItem.create({
      data: {
        price_list_id: priceListId,
        service_id: dto.service_id,
        unit_price: dto.unit_price,
        created_by_id: user.profileId,
      },
      include: {
        service: { select: { id: true, name: true, code: true, service_type: true } },
      },
    });
  }

  async updateItem(
    organizationId: string,
    priceListId: string,
    itemId: string,
    dto: UpdatePriceListItemDto,
    user: AuthContext,
  ) {
    const list = await this.findListOrThrow(organizationId, priceListId);
    await this.assertCanManageList(user, organizationId, list.branch_id ?? undefined);

    const item = await this.prismaService.db.priceListItem.findFirst({
      where: { id: itemId, price_list_id: priceListId, is_deleted: false },
    });
    if (!item) throw new NotFoundException('Price list item not found');

    return this.prismaService.db.priceListItem.update({
      where: { id: itemId },
      data: { unit_price: dto.unit_price },
      include: {
        service: { select: { id: true, name: true, code: true, service_type: true } },
      },
    });
  }

  async removeItem(
    organizationId: string,
    priceListId: string,
    itemId: string,
    user: AuthContext,
  ): Promise<void> {
    const list = await this.findListOrThrow(organizationId, priceListId);
    await this.assertCanManageList(user, organizationId, list.branch_id ?? undefined);

    const item = await this.prismaService.db.priceListItem.findFirst({
      where: { id: itemId, price_list_id: priceListId, is_deleted: false },
    });
    if (!item) throw new NotFoundException('Price list item not found');

    await this.prismaService.db.priceListItem.update({
      where: { id: itemId },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  private async findListOrThrow(organizationId: string, priceListId: string) {
    const list = await this.prismaService.db.priceList.findFirst({
      where: { id: priceListId, organization_id: organizationId, is_deleted: false },
    });
    if (!list) throw new NotFoundException('Price list not found');
    return list;
  }

  private async assertCanManageList(
    user: AuthContext,
    organizationId: string,
    branchId?: string,
  ): Promise<void> {
    if (branchId) {
      await this.authorizationService.assertCanManageBranch(
        user.profileId,
        organizationId,
        branchId,
      );
    } else {
      await this.authorizationService.assertCanManageOrganization(
        user.profileId,
        organizationId,
      );
    }
  }
}
