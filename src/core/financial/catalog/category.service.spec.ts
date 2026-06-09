import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CatalogCategoryService } from './category.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

const mockDb = {
  serviceCategory: {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};
const mockPrisma = { db: mockDb };
const mockAuth = {
  assertCanManageOrganization: jest.fn(),
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

describe('CatalogCategoryService', () => {
  let service: CatalogCategoryService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CatalogCategoryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthorizationService, useValue: mockAuth },
      ],
    }).compile();

    service = module.get(CatalogCategoryService);
    jest.clearAllMocks();
    mockAuth.assertCanManageOrganization.mockResolvedValue(undefined);
    mockAuth.assertCanAccessOrganization.mockResolvedValue(undefined);
  });

  describe('findAll', () => {
    it('returns paginated categories including system-wide', async () => {
      mockDb.serviceCategory.findMany.mockResolvedValue([
        { id: 'c1', code: 'ANC', name: 'Antenatal' },
      ]);
      mockDb.serviceCategory.count.mockResolvedValue(1);

      const result = await service.findAll(ORG, {}, 1, 20, USER);

      expect(result.items).toHaveLength(1);
      const whereArg = mockDb.serviceCategory.findMany.mock.calls[0][0].where;
      expect(whereArg.OR).toEqual([
        { organization_id: ORG },
        { organization_id: null },
      ]);
    });
  });

  describe('create', () => {
    it('creates a category', async () => {
      mockDb.serviceCategory.findFirst.mockResolvedValue(null);
      mockDb.serviceCategory.create.mockResolvedValue({
        id: 'c1',
        code: 'ANC',
        name: 'Antenatal',
      });

      const result = await service.create(
        ORG,
        { code: 'ANC', name: 'Antenatal' },
        USER,
      );

      expect(mockAuth.assertCanManageOrganization).toHaveBeenCalledWith(
        'p1',
        ORG,
      );
      expect(result.code).toBe('ANC');
    });

    it('throws ConflictException on duplicate code', async () => {
      mockDb.serviceCategory.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create(ORG, { code: 'DUP', name: 'X' }, USER),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('updates an org-owned category', async () => {
      mockDb.serviceCategory.findFirst.mockResolvedValue({
        id: 'c1',
        organization_id: ORG,
      });
      mockDb.serviceCategory.update.mockResolvedValue({
        id: 'c1',
        code: 'ANC',
        name: 'Renamed',
      });

      const result = await service.update(
        ORG,
        'c1',
        { name: 'Renamed', is_active: false },
        USER,
      );

      expect(result.name).toBe('Renamed');
      expect(mockDb.serviceCategory.update.mock.calls[0][0].data).toEqual({
        name: 'Renamed',
        is_active: false,
      });
    });

    it('throws NotFoundException for a system or missing category', async () => {
      mockDb.serviceCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.update(ORG, 'missing', { name: 'X' }, USER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('soft-deletes the category', async () => {
      mockDb.serviceCategory.findFirst.mockResolvedValue({
        id: 'c1',
        organization_id: ORG,
      });
      mockDb.serviceCategory.update.mockResolvedValue({});

      await service.remove(ORG, 'c1', USER);

      expect(mockDb.serviceCategory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ is_deleted: true, is_active: false }),
        }),
      );
    });
  });
});
