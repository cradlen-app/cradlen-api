import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DiscountType } from '@prisma/client';
import { PriceListsService } from './price-lists.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

const mockDb = {
  priceList: {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  priceListItem: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  priceListItemTier: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  service: { findFirst: jest.fn() },
  $transaction: jest.fn(),
};

const mockPrisma = { db: mockDb };
const mockAuth = {
  assertCanManageOrganization: jest.fn(),
  assertCanManageBranch: jest.fn(),
  assertCanAccessOrganization: jest.fn(),
};

const ORG = 'org-1';
const USER: AuthContext = {
  userId: 'u1',
  profileId: 'p1',
  organizationId: ORG,
  roles: ['OWNER'],
  branchIds: [],
};

const LIST = {
  id: 'pl-1',
  organization_id: ORG,
  branch_id: null,
  is_default: false,
  currency: 'EGP',
  is_deleted: false,
};

describe('PriceListsService', () => {
  let service: PriceListsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PriceListsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthorizationService, useValue: mockAuth },
      ],
    }).compile();

    service = module.get(PriceListsService);
    jest.clearAllMocks();
    mockAuth.assertCanManageOrganization.mockResolvedValue(undefined);
    mockAuth.assertCanManageBranch.mockResolvedValue(undefined);
    mockAuth.assertCanAccessOrganization.mockResolvedValue(undefined);
    mockDb.$transaction.mockImplementation(
      (fn: (tx: typeof mockDb) => unknown) => fn(mockDb),
    );
  });

  describe('findAll', () => {
    it('returns paginated price lists', async () => {
      mockDb.priceList.findMany.mockResolvedValue([LIST]);
      mockDb.priceList.count.mockResolvedValue(1);

      const result = await service.findAll(ORG, undefined, 1, 20, USER);

      expect(result.items).toHaveLength(1);
    });

    it('rejects a non-member', async () => {
      mockAuth.assertCanAccessOrganization.mockRejectedValue(
        new ForbiddenException(),
      );
      await expect(
        service.findAll(ORG, undefined, 1, 20, USER),
      ).rejects.toThrow(ForbiddenException);
      expect(mockDb.priceList.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getOne', () => {
    it('returns the list with items', async () => {
      mockDb.priceList.findFirst.mockResolvedValue({ ...LIST, items: [] });
      const result = await service.getOne(ORG, 'pl-1', USER);
      expect(result.id).toBe('pl-1');
    });

    it('throws NotFound when missing', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(null);
      await expect(service.getOne(ORG, 'missing', USER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findItems', () => {
    it('rejects a non-member before reading items', async () => {
      mockAuth.assertCanAccessOrganization.mockRejectedValue(
        new ForbiddenException(),
      );
      await expect(service.findItems(ORG, 'pl-1', USER)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockDb.priceListItem.findMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates a price list', async () => {
      mockDb.priceList.create.mockResolvedValue(LIST);

      await service.create(ORG, { name: 'Main List' }, USER);

      expect(mockAuth.assertCanManageOrganization).toHaveBeenCalledWith(
        USER.profileId,
        ORG,
      );
      expect(mockDb.priceList.create).toHaveBeenCalled();
    });

    it('atomically unsets the prior default when creating a default', async () => {
      mockDb.priceList.create.mockResolvedValue({ ...LIST, is_default: true });

      await service.create(ORG, { name: 'Default', is_default: true }, USER);

      expect(mockDb.priceList.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { is_default: false },
        }),
      );
      expect(mockDb.priceList.create).toHaveBeenCalled();
    });

    it('rejects valid_from >= valid_to', async () => {
      await expect(
        service.create(
          ORG,
          { name: 'X', valid_from: '2026-02-01', valid_to: '2026-01-01' },
          USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an out-of-range percentage discount', async () => {
      await expect(
        service.create(
          ORG,
          {
            name: 'X',
            discount_type: DiscountType.PERCENTAGE,
            discount_value: 150,
          },
          USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a discount_type without a value', async () => {
      await expect(
        service.create(
          ORG,
          { name: 'X', discount_type: DiscountType.FIXED },
          USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('uses branch auth when branch_id is provided', async () => {
      mockDb.priceList.create.mockResolvedValue(LIST);
      await service.create(ORG, { name: 'B', branch_id: 'br-1' }, USER);
      expect(mockAuth.assertCanManageBranch).toHaveBeenCalledWith(
        USER.profileId,
        ORG,
        'br-1',
      );
    });
  });

  describe('update / setDefault', () => {
    it('updates fields', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(LIST);
      mockDb.priceList.update.mockResolvedValue({ ...LIST, name: 'Updated' });
      const result = await service.update(
        ORG,
        'pl-1',
        { name: 'Updated' },
        USER,
      );
      expect(result.name).toBe('Updated');
    });

    it('promoting to default replaces the prior default atomically', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(LIST);
      mockDb.priceList.update.mockResolvedValue({ ...LIST, is_default: true });

      await service.update(ORG, 'pl-1', { is_default: true }, USER);

      expect(mockDb.priceList.updateMany).toHaveBeenCalled();
      expect(mockDb.priceList.update.mock.calls[0][0].data.is_default).toBe(
        true,
      );
    });

    it('setDefault unsets others and sets this list', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(LIST);
      mockDb.priceList.update.mockResolvedValue({ ...LIST, is_default: true });

      await service.setDefault(ORG, 'pl-1', USER);

      expect(mockDb.priceList.updateMany).toHaveBeenCalled();
      expect(mockDb.priceList.update.mock.calls[0][0].data).toEqual({
        is_default: true,
      });
    });

    it('throws NotFound when list missing', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(null);
      await expect(
        service.update(ORG, 'missing', { name: 'X' }, USER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('activate / deactivate', () => {
    it('deactivates a list', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(LIST);
      mockDb.priceList.update.mockResolvedValue({ ...LIST, is_active: false });
      await service.deactivate(ORG, 'pl-1', USER);
      expect(mockDb.priceList.update.mock.calls[0][0].data).toEqual({
        is_active: false,
      });
    });
  });

  describe('remove', () => {
    it('soft-deletes the price list', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(LIST);
      mockDb.priceList.update.mockResolvedValue({});
      await service.remove(ORG, 'pl-1', USER);
      expect(mockDb.priceList.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ is_deleted: true, is_active: false }),
        }),
      );
    });
  });

  describe('addItem', () => {
    it('validates the service, persists, and writes tiers', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(LIST);
      mockDb.service.findFirst.mockResolvedValue({ id: 'svc-1' });
      mockDb.priceListItem.findFirst.mockResolvedValue(null); // no duplicate
      mockDb.priceListItem.create.mockResolvedValue({ id: 'item-1' });
      mockDb.priceListItem.findUniqueOrThrow.mockResolvedValue({
        id: 'item-1',
        tiers: [{ min_quantity: 5, unit_price: 90 }],
      });

      await service.addItem(
        ORG,
        'pl-1',
        {
          service_id: 'svc-1',
          unit_price: 100,
          tiers: [{ min_quantity: 5, unit_price: 90 }],
        },
        USER,
      );

      expect(mockDb.priceListItemTier.createMany).toHaveBeenCalled();
    });

    it('rejects an unknown service', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(LIST);
      mockDb.service.findFirst.mockResolvedValue(null);

      await expect(
        service.addItem(
          ORG,
          'pl-1',
          { service_id: 'bad', unit_price: 100 },
          USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException if service already in list', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(LIST);
      mockDb.service.findFirst.mockResolvedValue({ id: 'svc-1' });
      mockDb.priceListItem.findFirst.mockResolvedValue({ id: 'existing-item' });

      await expect(
        service.addItem(
          ORG,
          'pl-1',
          { service_id: 'svc-1', unit_price: 100 },
          USER,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects duplicate tier min_quantity', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(LIST);
      mockDb.service.findFirst.mockResolvedValue({ id: 'svc-1' });

      await expect(
        service.addItem(
          ORG,
          'pl-1',
          {
            service_id: 'svc-1',
            unit_price: 100,
            tiers: [
              { min_quantity: 5, unit_price: 90 },
              { min_quantity: 5, unit_price: 80 },
            ],
          },
          USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('setItems', () => {
    it('replaces the item set in a transaction', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(LIST);
      mockDb.service.findFirst.mockResolvedValue({ id: 'svc-1' });
      mockDb.priceListItem.findMany
        .mockResolvedValueOnce([]) // existing, inside tx
        .mockResolvedValueOnce([{ id: 'item-new', tiers: [] }]); // final return
      mockDb.priceListItem.create.mockResolvedValue({ id: 'item-new' });

      const result = await service.setItems(
        ORG,
        'pl-1',
        { items: [{ service_id: 'svc-1', unit_price: 50 }] },
        USER,
      );

      expect(mockDb.priceListItem.create).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });

    it('rejects duplicate service_id in the payload', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(LIST);

      await expect(
        service.setItems(
          ORG,
          'pl-1',
          {
            items: [
              { service_id: 'svc-1', unit_price: 50 },
              { service_id: 'svc-1', unit_price: 60 },
            ],
          },
          USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeItem', () => {
    it('throws NotFoundException when item not found', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(LIST);
      mockDb.priceListItem.findFirst.mockResolvedValue(null);
      await expect(
        service.removeItem(ORG, 'pl-1', 'missing-item', USER),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
