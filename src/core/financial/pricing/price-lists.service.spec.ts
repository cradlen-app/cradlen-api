import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PriceListsService } from './price-lists.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';

const mockDb = {
  priceList: {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  priceListItem: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockPrisma = { db: mockDb };
const mockAuth = {
  assertCanManageOrganization: jest.fn(),
  assertCanManageBranch: jest.fn(),
};

const ORG = 'org-1';
const USER = {
  userId: 'u1',
  profileId: 'p1',
  organizationId: ORG,
  roles: ['OWNER'],
  branchIds: [],
} as any;

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
  });

  describe('findAll', () => {
    it('returns paginated price lists', async () => {
      mockDb.priceList.findMany.mockResolvedValue([LIST]);
      mockDb.priceList.count.mockResolvedValue(1);

      const result = await service.findAll(ORG, undefined, 1, 20);

      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('filters by branchId when provided', async () => {
      mockDb.priceList.findMany.mockResolvedValue([]);
      mockDb.priceList.count.mockResolvedValue(0);

      await service.findAll(ORG, 'br-1');

      const whereArg = mockDb.priceList.findMany.mock.calls[0][0].where;
      expect(whereArg.branch_id).toBe('br-1');
    });
  });

  describe('create', () => {
    it('creates a price list', async () => {
      mockDb.priceList.create.mockResolvedValue(LIST);

      const result = await service.create(ORG, { name: 'Main List', currency: 'EGP' }, USER);

      expect(mockAuth.assertCanManageOrganization).toHaveBeenCalledWith(USER.profileId, ORG);
      expect(result).toEqual(LIST);
    });

    it('throws ConflictException if default already exists', async () => {
      mockDb.priceList.findFirst.mockResolvedValue({ id: 'existing-default' });

      await expect(
        service.create(ORG, { name: 'X', is_default: true }, USER),
      ).rejects.toThrow(ConflictException);
    });

    it('uses branch auth when branch_id is provided', async () => {
      mockDb.priceList.create.mockResolvedValue(LIST);

      await service.create(ORG, { name: 'Branch List', branch_id: 'br-1' }, USER);

      expect(mockAuth.assertCanManageBranch).toHaveBeenCalledWith(USER.profileId, ORG, 'br-1');
      expect(mockAuth.assertCanManageOrganization).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates price list fields', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(LIST);
      mockDb.priceList.update.mockResolvedValue({ ...LIST, name: 'Updated' });

      const result = await service.update(ORG, 'pl-1', { name: 'Updated' }, USER);

      expect(result.name).toBe('Updated');
    });

    it('throws ConflictException when promoting to default and one already exists', async () => {
      mockDb.priceList.findFirst
        .mockResolvedValueOnce(LIST) // findListOrThrow
        .mockResolvedValueOnce({ id: 'other-default' }); // existing default check

      await expect(
        service.update(ORG, 'pl-1', { is_default: true }, USER),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when list not found', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(null);

      await expect(service.update(ORG, 'missing', { name: 'X' }, USER)).rejects.toThrow(
        NotFoundException,
      );
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

    it('throws NotFoundException when list not found', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(null);

      await expect(service.remove(ORG, 'missing', USER)).rejects.toThrow(NotFoundException);
    });
  });

  describe('addItem', () => {
    it('throws ConflictException if service already in list', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(LIST);
      mockDb.priceListItem.findFirst.mockResolvedValue({ id: 'existing-item' });

      await expect(
        service.addItem(ORG, 'pl-1', { service_id: 'svc-1', unit_price: 100 }, USER),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('removeItem', () => {
    it('throws NotFoundException when item not found', async () => {
      mockDb.priceList.findFirst.mockResolvedValue(LIST);
      mockDb.priceListItem.findFirst.mockResolvedValue(null);

      await expect(service.removeItem(ORG, 'pl-1', 'missing-item', USER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
