import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ServiceType } from '@prisma/client';
import { CatalogService } from './catalog.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

const mockDb = {
  service: {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  serviceSpecialty: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  serviceCategory: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
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

describe('CatalogService', () => {
  let service: CatalogService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthorizationService, useValue: mockAuth },
      ],
    }).compile();

    service = module.get(CatalogService);
    jest.clearAllMocks();
    mockAuth.assertCanManageOrganization.mockResolvedValue(undefined);
    mockAuth.assertCanAccessOrganization.mockResolvedValue(undefined);
  });

  describe('findAll', () => {
    it('returns paginated services', async () => {
      const items = [
        { id: 's1', name: 'Consultation', specialties: [] },
        { id: 's2', name: 'Lab Test', specialties: [{ specialty_id: 'sp1' }] },
      ];
      mockDb.service.findMany.mockResolvedValue(items);
      mockDb.service.count.mockResolvedValue(2);

      const result = await service.findAll(ORG, {}, 1, 20, USER);

      expect(result.items).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.items[1].specialty_ids).toEqual(['sp1']);
    });

    it('filters by service_type', async () => {
      mockDb.service.findMany.mockResolvedValue([]);
      mockDb.service.count.mockResolvedValue(0);

      await service.findAll(
        ORG,
        { service_type: ServiceType.LAB_TEST },
        1,
        20,
        USER,
      );

      const whereArg = mockDb.service.findMany.mock.calls[0][0].where;
      expect(whereArg.service_type).toBe(ServiceType.LAB_TEST);
    });
  });

  describe('create', () => {
    it('creates a service with specialty ids', async () => {
      mockDb.service.findFirst.mockResolvedValue(null);
      const created = {
        id: 's1',
        name: 'Test',
        specialties: [{ specialty_id: 'sp1' }],
      };
      mockDb.service.create.mockResolvedValue(created);

      const result = await service.create(
        ORG,
        {
          code: 'TST',
          name: 'Test',
          service_type: ServiceType.PROCEDURE,
          specialty_ids: ['sp1'],
        },
        USER,
      );

      expect(mockAuth.assertCanManageOrganization).toHaveBeenCalledWith(
        USER.profileId,
        ORG,
      );
      expect(result.specialty_ids).toEqual(['sp1']);
    });

    it('throws ConflictException if code already exists', async () => {
      mockDb.service.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create(
          ORG,
          { code: 'DUP', name: 'X', service_type: ServiceType.OTHER },
          USER,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('updates service fields and replaces specialties', async () => {
      mockDb.service.findFirst.mockResolvedValue({
        id: 's1',
        organization_id: ORG,
      });
      const updated = { id: 's1', name: 'Updated', specialties: [] };

      mockDb.$transaction.mockImplementation(
        (fn: (tx: typeof mockDb) => unknown) => fn(mockDb),
      );
      mockDb.service.update.mockResolvedValue(updated);

      const result = await service.update(
        ORG,
        's1',
        { name: 'Updated', specialty_ids: [] },
        USER,
      );

      expect(mockAuth.assertCanManageOrganization).toHaveBeenCalled();
      expect(result.specialty_ids).toEqual([]);
    });

    it('throws NotFoundException when service not in org', async () => {
      mockDb.service.findFirst.mockResolvedValue(null);

      await expect(
        service.update(ORG, 'missing', { name: 'X' }, USER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('soft-deletes the service', async () => {
      mockDb.service.findFirst.mockResolvedValue({
        id: 's1',
        organization_id: ORG,
      });
      mockDb.service.update.mockResolvedValue({});

      await service.remove(ORG, 's1', USER);

      expect(mockDb.service.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ is_deleted: true, is_active: false }),
        }),
      );
    });

    it('throws NotFoundException when service not found', async () => {
      mockDb.service.findFirst.mockResolvedValue(null);

      await expect(service.remove(ORG, 'missing', USER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getOne', () => {
    it('returns the service with embedded category', async () => {
      mockDb.service.findFirst.mockResolvedValue({
        id: 's1',
        name: 'Consultation',
        specialties: [],
        category: { id: 'cat-1', code: 'ANC', name: 'Antenatal' },
      });

      const result = await service.getOne(ORG, 's1', USER);

      expect(result.category).toEqual({
        id: 'cat-1',
        code: 'ANC',
        name: 'Antenatal',
      });
    });

    it('throws NotFoundException when missing', async () => {
      mockDb.service.findFirst.mockResolvedValue(null);
      await expect(service.getOne(ORG, 'missing', USER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('activate / deactivate', () => {
    it('activates a service', async () => {
      mockDb.service.findFirst.mockResolvedValue({ id: 's1' });
      mockDb.service.update.mockResolvedValue({ id: 's1', specialties: [] });

      await service.activate(ORG, 's1', USER);

      expect(mockDb.service.update.mock.calls[0][0].data).toEqual({
        is_active: true,
      });
    });

    it('deactivates a service', async () => {
      mockDb.service.findFirst.mockResolvedValue({ id: 's1' });
      mockDb.service.update.mockResolvedValue({ id: 's1', specialties: [] });

      await service.deactivate(ORG, 's1', USER);

      expect(mockDb.service.update.mock.calls[0][0].data).toEqual({
        is_active: false,
      });
    });
  });

  describe('create with category', () => {
    it('validates the category and persists the new attributes', async () => {
      mockDb.service.findFirst.mockResolvedValue(null); // no code conflict
      mockDb.serviceCategory.findFirst.mockResolvedValue({ id: 'cat-1' });
      mockDb.service.create.mockResolvedValue({ id: 's1', specialties: [] });

      await service.create(
        ORG,
        {
          code: 'CONS',
          name: 'Consultation',
          service_type: ServiceType.CONSULTATION,
          category_id: 'cat-1',
          duration_minutes: 30,
          billing_code: '99213',
        },
        USER,
      );

      const data = mockDb.service.create.mock.calls[0][0].data;
      expect(data.category_id).toBe('cat-1');
      expect(data.duration_minutes).toBe(30);
      expect(data.billing_code).toBe('99213');
    });

    it('rejects an unknown category', async () => {
      mockDb.service.findFirst.mockResolvedValue(null);
      mockDb.serviceCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          ORG,
          {
            code: 'CONS',
            name: 'Consultation',
            service_type: ServiceType.CONSULTATION,
            category_id: 'bad-cat',
          },
          USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cross-tenant read protection', () => {
    it('rejects findAll when the caller is not a member of the org', async () => {
      mockAuth.assertCanAccessOrganization.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(service.findAll(ORG, {}, 1, 20, USER)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockDb.service.findMany).not.toHaveBeenCalled();
    });

    it('rejects getOne when the caller is not a member of the org', async () => {
      mockAuth.assertCanAccessOrganization.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(service.getOne(ORG, 's1', USER)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockDb.service.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('findAll category filter', () => {
    it('filters by category_id', async () => {
      mockDb.service.findMany.mockResolvedValue([]);
      mockDb.service.count.mockResolvedValue(0);

      await service.findAll(ORG, { category_id: 'cat-1' }, 1, 20, USER);

      const whereArg = mockDb.service.findMany.mock.calls[0][0].where;
      expect(whereArg.category_id).toBe('cat-1');
    });
  });
});
