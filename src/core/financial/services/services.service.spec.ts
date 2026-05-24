import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ServiceType } from '@prisma/client';
import { ServicesService } from './services.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';

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
  $transaction: jest.fn(),
};

const mockPrisma = { db: mockDb };
const mockAuth = { assertCanManageOrganization: jest.fn() };

const ORG = 'org-1';
const USER = {
  userId: 'u1',
  profileId: 'p1',
  organizationId: ORG,
  roles: ['OWNER'],
  branchIds: [],
} as any;

describe('ServicesService', () => {
  let service: ServicesService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServicesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthorizationService, useValue: mockAuth },
      ],
    }).compile();

    service = module.get(ServicesService);
    jest.clearAllMocks();
    mockAuth.assertCanManageOrganization.mockResolvedValue(undefined);
  });

  describe('findAll', () => {
    it('returns paginated services', async () => {
      const items = [
        { id: 's1', name: 'Consultation', specialties: [] },
        { id: 's2', name: 'Lab Test', specialties: [{ specialty_id: 'sp1' }] },
      ];
      mockDb.service.findMany.mockResolvedValue(items);
      mockDb.service.count.mockResolvedValue(2);

      const result = await service.findAll(ORG, {}, 1, 20);

      expect(result.items).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.items[1].specialty_ids).toEqual(['sp1']);
    });

    it('filters by service_type', async () => {
      mockDb.service.findMany.mockResolvedValue([]);
      mockDb.service.count.mockResolvedValue(0);

      await service.findAll(ORG, { service_type: ServiceType.LAB_TEST });

      const whereArg = mockDb.service.findMany.mock.calls[0][0].where;
      expect(whereArg.service_type).toBe(ServiceType.LAB_TEST);
    });
  });

  describe('create', () => {
    it('creates a service with specialty ids', async () => {
      mockDb.service.findFirst.mockResolvedValue(null);
      const created = { id: 's1', name: 'Test', specialties: [{ specialty_id: 'sp1' }] };
      mockDb.service.create.mockResolvedValue(created);

      const result = await service.create(
        ORG,
        { code: 'TST', name: 'Test', service_type: ServiceType.PROCEDURE, specialty_ids: ['sp1'] },
        USER,
      );

      expect(mockAuth.assertCanManageOrganization).toHaveBeenCalledWith(USER.profileId, ORG);
      expect(result.specialty_ids).toEqual(['sp1']);
    });

    it('throws ConflictException if code already exists', async () => {
      mockDb.service.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create(ORG, { code: 'DUP', name: 'X', service_type: ServiceType.OTHER }, USER),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('updates service fields and replaces specialties', async () => {
      mockDb.service.findFirst.mockResolvedValue({ id: 's1', organization_id: ORG });
      const updated = { id: 's1', name: 'Updated', specialties: [] };

      mockDb.$transaction.mockImplementation(async (fn: any) => fn(mockDb));
      mockDb.service.update.mockResolvedValue(updated);

      const result = await service.update(ORG, 's1', { name: 'Updated', specialty_ids: [] }, USER);

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
      mockDb.service.findFirst.mockResolvedValue({ id: 's1', organization_id: ORG });
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

      await expect(service.remove(ORG, 'missing', USER)).rejects.toThrow(NotFoundException);
    });
  });
});
