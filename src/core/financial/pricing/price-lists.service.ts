import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DiscountType, Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { DEFAULT_CURRENCY } from '../shared/currency.js';
import type { CreatePriceListDto } from './dto/create-price-list.dto.js';
import type { CreatePriceListItemDto } from './dto/create-price-list-item.dto.js';
import type { UpdatePriceListItemDto } from './dto/update-price-list-item.dto.js';
import type { UpdatePriceListDto } from './dto/update-price-list.dto.js';
import type { SetPriceListItemsDto } from './dto/set-price-list-items.dto.js';
import type { PriceTierDto } from './dto/price-tier.dto.js';

const ITEM_INCLUDE = {
  service: { select: { id: true, name: true, code: true, service_type: true } },
  tiers: { orderBy: { min_quantity: 'asc' } },
} satisfies Prisma.PriceListItemInclude;

type TxClient = Prisma.TransactionClient;

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
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      organizationId,
    );

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

  async getOne(organizationId: string, priceListId: string, user: AuthContext) {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      organizationId,
    );
    const list = await this.prismaService.db.priceList.findFirst({
      where: {
        id: priceListId,
        organization_id: organizationId,
        is_deleted: false,
      },
      include: {
        items: {
          where: { is_deleted: false },
          orderBy: { created_at: 'asc' },
          include: ITEM_INCLUDE,
        },
      },
    });
    if (!list) throw new NotFoundException('Price list not found');
    return list;
  }

  async create(
    organizationId: string,
    dto: CreatePriceListDto,
    user: AuthContext,
  ) {
    await this.assertCanManageList(user, organizationId, dto.branch_id);
    this.assertValidDates(dto.valid_from, dto.valid_to);
    this.assertValidDiscount(dto.discount_type, dto.discount_value);

    const branchId = dto.branch_id ?? null;
    const data: Prisma.PriceListCreateInput = {
      organization: { connect: { id: organizationId } },
      ...(branchId && { branch: { connect: { id: branchId } } }),
      name: dto.name,
      currency: dto.currency ?? DEFAULT_CURRENCY,
      is_default: dto.is_default ?? false,
      discount_type: dto.discount_type ?? null,
      discount_value: dto.discount_value ?? null,
      valid_from: dto.valid_from ? new Date(dto.valid_from) : null,
      valid_to: dto.valid_to ? new Date(dto.valid_to) : null,
      created_by: { connect: { id: user.profileId } },
    };

    if (dto.is_default) {
      return this.prismaService.db.$transaction(async (tx) => {
        await this.unsetDefaults(tx, organizationId, branchId, null);
        return tx.priceList.create({ data });
      });
    }
    return this.prismaService.db.priceList.create({ data });
  }

  async update(
    organizationId: string,
    priceListId: string,
    dto: UpdatePriceListDto,
    user: AuthContext,
  ) {
    const list = await this.findListOrThrow(organizationId, priceListId);
    await this.assertCanManageList(
      user,
      organizationId,
      list.branch_id ?? undefined,
    );
    this.assertValidDates(dto.valid_from, dto.valid_to);
    this.assertValidDiscount(dto.discount_type, dto.discount_value);

    const data: Prisma.PriceListUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.branch_id !== undefined && {
        branch: dto.branch_id
          ? { connect: { id: dto.branch_id } }
          : { disconnect: true },
      }),
      ...(dto.currency !== undefined && { currency: dto.currency }),
      ...(dto.discount_type !== undefined && {
        discount_type: dto.discount_type,
      }),
      ...(dto.discount_value !== undefined && {
        discount_value: dto.discount_value,
      }),
      ...(dto.valid_from !== undefined && {
        valid_from: dto.valid_from ? new Date(dto.valid_from) : null,
      }),
      ...(dto.valid_to !== undefined && {
        valid_to: dto.valid_to ? new Date(dto.valid_to) : null,
      }),
    };

    // Becoming the default atomically replaces the prior default in scope.
    if (dto.is_default === true && !list.is_default) {
      return this.prismaService.db.$transaction(async (tx) => {
        await this.unsetDefaults(
          tx,
          organizationId,
          list.branch_id,
          priceListId,
        );
        return tx.priceList.update({
          where: { id: priceListId },
          data: { ...data, is_default: true },
        });
      });
    }
    if (dto.is_default === false) data.is_default = false;

    return this.prismaService.db.priceList.update({
      where: { id: priceListId },
      data,
    });
  }

  async setDefault(
    organizationId: string,
    priceListId: string,
    user: AuthContext,
  ) {
    const list = await this.findListOrThrow(organizationId, priceListId);
    await this.assertCanManageList(
      user,
      organizationId,
      list.branch_id ?? undefined,
    );
    return this.prismaService.db.$transaction(async (tx) => {
      await this.unsetDefaults(tx, organizationId, list.branch_id, priceListId);
      return tx.priceList.update({
        where: { id: priceListId },
        data: { is_default: true },
      });
    });
  }

  async activate(orgId: string, priceListId: string, user: AuthContext) {
    return this.setActive(orgId, priceListId, true, user);
  }

  async deactivate(orgId: string, priceListId: string, user: AuthContext) {
    return this.setActive(orgId, priceListId, false, user);
  }

  async remove(
    organizationId: string,
    priceListId: string,
    user: AuthContext,
  ): Promise<void> {
    const list = await this.findListOrThrow(organizationId, priceListId);
    await this.assertCanManageList(
      user,
      organizationId,
      list.branch_id ?? undefined,
    );
    await this.prismaService.db.priceList.update({
      where: { id: priceListId },
      data: { is_deleted: true, deleted_at: new Date(), is_active: false },
    });
  }

  // ---------- Items ----------

  async findItems(
    organizationId: string,
    priceListId: string,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      organizationId,
    );
    await this.findListOrThrow(organizationId, priceListId);

    return this.prismaService.db.priceListItem.findMany({
      where: { price_list_id: priceListId, is_deleted: false },
      include: ITEM_INCLUDE,
    });
  }

  async getItem(
    organizationId: string,
    priceListId: string,
    itemId: string,
    user: AuthContext,
  ) {
    await this.authorizationService.assertCanAccessOrganization(
      user.profileId,
      organizationId,
    );
    await this.findListOrThrow(organizationId, priceListId);
    const item = await this.prismaService.db.priceListItem.findFirst({
      where: { id: itemId, price_list_id: priceListId, is_deleted: false },
      include: ITEM_INCLUDE,
    });
    if (!item) throw new NotFoundException('Price list item not found');
    return item;
  }

  async addItem(
    organizationId: string,
    priceListId: string,
    dto: CreatePriceListItemDto,
    user: AuthContext,
  ) {
    const list = await this.findListOrThrow(organizationId, priceListId);
    await this.assertCanManageList(
      user,
      organizationId,
      list.branch_id ?? undefined,
    );
    await this.assertServiceExists(organizationId, dto.service_id);
    this.assertValidDiscount(dto.discount_type, dto.discount_value);
    this.assertValidTiers(dto.tiers);

    const duplicate = await this.prismaService.db.priceListItem.findFirst({
      where: {
        price_list_id: priceListId,
        service_id: dto.service_id,
        is_deleted: false,
      },
    });
    if (duplicate) {
      throw new ConflictException('Service already exists in this price list');
    }

    return this.prismaService.db.$transaction(async (tx) => {
      const item = await tx.priceListItem.create({
        data: {
          price_list_id: priceListId,
          service_id: dto.service_id,
          unit_price: dto.unit_price,
          discount_type: dto.discount_type ?? null,
          discount_value: dto.discount_value ?? null,
          created_by_id: user.profileId,
        },
      });
      await this.writeTiers(tx, item.id, dto.tiers);
      return tx.priceListItem.findUniqueOrThrow({
        where: { id: item.id },
        include: ITEM_INCLUDE,
      });
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
    await this.assertCanManageList(
      user,
      organizationId,
      list.branch_id ?? undefined,
    );
    this.assertValidDiscount(dto.discount_type, dto.discount_value);
    this.assertValidTiers(dto.tiers);

    const item = await this.prismaService.db.priceListItem.findFirst({
      where: { id: itemId, price_list_id: priceListId, is_deleted: false },
    });
    if (!item) throw new NotFoundException('Price list item not found');

    return this.prismaService.db.$transaction(async (tx) => {
      await tx.priceListItem.update({
        where: { id: itemId },
        data: {
          ...(dto.unit_price !== undefined && { unit_price: dto.unit_price }),
          ...(dto.discount_type !== undefined && {
            discount_type: dto.discount_type,
          }),
          ...(dto.discount_value !== undefined && {
            discount_value: dto.discount_value,
          }),
        },
      });
      if (dto.tiers !== undefined) await this.writeTiers(tx, itemId, dto.tiers);
      return tx.priceListItem.findUniqueOrThrow({
        where: { id: itemId },
        include: ITEM_INCLUDE,
      });
    });
  }

  /** Bulk replace: the list's items become exactly `dto.items` (keyed by service_id). */
  async setItems(
    organizationId: string,
    priceListId: string,
    dto: SetPriceListItemsDto,
    user: AuthContext,
  ) {
    const list = await this.findListOrThrow(organizationId, priceListId);
    await this.assertCanManageList(
      user,
      organizationId,
      list.branch_id ?? undefined,
    );

    const serviceIds = dto.items.map((i) => i.service_id);
    if (new Set(serviceIds).size !== serviceIds.length) {
      throw new BadRequestException('Duplicate service_id in items');
    }
    for (const item of dto.items) {
      await this.assertServiceExists(organizationId, item.service_id);
      this.assertValidDiscount(item.discount_type, item.discount_value);
      this.assertValidTiers(item.tiers);
    }

    await this.prismaService.db.$transaction(async (tx) => {
      const existing = await tx.priceListItem.findMany({
        where: { price_list_id: priceListId, is_deleted: false },
        select: { id: true, service_id: true },
      });
      const keep = new Set(serviceIds);
      // Soft-delete items no longer present.
      const toRemove = existing
        .filter((e) => !keep.has(e.service_id))
        .map((e) => e.id);
      if (toRemove.length) {
        await tx.priceListItem.updateMany({
          where: { id: { in: toRemove } },
          data: { is_deleted: true, deleted_at: new Date() },
        });
      }
      const byService = new Map(existing.map((e) => [e.service_id, e.id]));
      for (const dtoItem of dto.items) {
        const existingId = byService.get(dtoItem.service_id);
        const itemId = existingId
          ? (
              await tx.priceListItem.update({
                where: { id: existingId },
                data: {
                  unit_price: dtoItem.unit_price,
                  discount_type: dtoItem.discount_type ?? null,
                  discount_value: dtoItem.discount_value ?? null,
                },
              })
            ).id
          : (
              await tx.priceListItem.create({
                data: {
                  price_list_id: priceListId,
                  service_id: dtoItem.service_id,
                  unit_price: dtoItem.unit_price,
                  discount_type: dtoItem.discount_type ?? null,
                  discount_value: dtoItem.discount_value ?? null,
                  created_by_id: user.profileId,
                },
              })
            ).id;
        await this.writeTiers(tx, itemId, dtoItem.tiers);
      }
    });

    return this.prismaService.db.priceListItem.findMany({
      where: { price_list_id: priceListId, is_deleted: false },
      include: ITEM_INCLUDE,
    });
  }

  async removeItem(
    organizationId: string,
    priceListId: string,
    itemId: string,
    user: AuthContext,
  ): Promise<void> {
    const list = await this.findListOrThrow(organizationId, priceListId);
    await this.assertCanManageList(
      user,
      organizationId,
      list.branch_id ?? undefined,
    );

    const item = await this.prismaService.db.priceListItem.findFirst({
      where: { id: itemId, price_list_id: priceListId, is_deleted: false },
    });
    if (!item) throw new NotFoundException('Price list item not found');

    await this.prismaService.db.priceListItem.update({
      where: { id: itemId },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  // ---------- Helpers ----------

  private async setActive(
    organizationId: string,
    priceListId: string,
    isActive: boolean,
    user: AuthContext,
  ) {
    const list = await this.findListOrThrow(organizationId, priceListId);
    await this.assertCanManageList(
      user,
      organizationId,
      list.branch_id ?? undefined,
    );
    return this.prismaService.db.priceList.update({
      where: { id: priceListId },
      data: { is_active: isActive },
    });
  }

  private async unsetDefaults(
    tx: TxClient,
    organizationId: string,
    branchId: string | null,
    exceptId: string | null,
  ): Promise<void> {
    await tx.priceList.updateMany({
      where: {
        organization_id: organizationId,
        branch_id: branchId,
        is_default: true,
        is_deleted: false,
        ...(exceptId && { NOT: { id: exceptId } }),
      },
      data: { is_default: false },
    });
  }

  private async writeTiers(
    tx: TxClient,
    itemId: string,
    tiers: PriceTierDto[] | undefined,
  ): Promise<void> {
    await tx.priceListItemTier.deleteMany({
      where: { price_list_item_id: itemId },
    });
    if (tiers?.length) {
      await tx.priceListItemTier.createMany({
        data: tiers.map((t) => ({
          price_list_item_id: itemId,
          min_quantity: t.min_quantity,
          unit_price: t.unit_price,
        })),
      });
    }
  }

  private assertValidDates(from?: string, to?: string): void {
    if (from && to && new Date(from) >= new Date(to)) {
      throw new BadRequestException('valid_from must be before valid_to');
    }
  }

  private assertValidDiscount(
    type: DiscountType | null | undefined,
    value: number | null | undefined,
  ): void {
    if (type === undefined || type === null) return;
    if (value === undefined || value === null) {
      throw new BadRequestException(
        'discount_value is required when discount_type is set',
      );
    }
    if (type === DiscountType.PERCENTAGE && (value < 0 || value > 100)) {
      throw new BadRequestException(
        'A percentage discount must be between 0 and 100',
      );
    }
  }

  private assertValidTiers(tiers: PriceTierDto[] | undefined): void {
    if (!tiers?.length) return;
    const seen = new Set<number>();
    for (const tier of tiers) {
      if (seen.has(tier.min_quantity)) {
        throw new BadRequestException(
          `Duplicate tier min_quantity: ${tier.min_quantity}`,
        );
      }
      seen.add(tier.min_quantity);
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

  private async findListOrThrow(organizationId: string, priceListId: string) {
    const list = await this.prismaService.db.priceList.findFirst({
      where: {
        id: priceListId,
        organization_id: organizationId,
        is_deleted: false,
      },
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
