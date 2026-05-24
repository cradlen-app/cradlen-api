import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProviderServicesService } from './provider-services.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';

const mockDb = {
  providerService: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  providerPriceOverride: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockPrisma = { db: mockDb };
const mockAuth = { assertCanManageStaff: jest.fn() };

const ORG = 'org-1';
const PROFILE = 'doc-1';
const USER = {
  userId: 'u1',
  profileId: 'mgr-1',
  organizationId: ORG,
  roles: ['OWNER'],
  branchIds: [],
} as any;

describe('ProviderServicesService', () => {
  let service: ProviderServicesService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProviderServicesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthorizationService, useValue: mockAuth },
      ],
    }).compile();

    service = module.get(ProviderServicesService);
    jest.clearAllMocks();
    mockAuth.assertCanManageStaff.mockResolvedValue(undefined);
  });

  describe('authorizeService', () => {
    it('creates a provider service authorization', async () => {
      mockDb.providerService.findFirst.mockResolvedValue(null);
      const created = { id: 'ps-1', service: { id: 'svc-1', name: 'Consultation' } };
      mockDb.providerService.create.mockResolvedValue(created);

      const result = await service.authorizeService(
        ORG,
        PROFILE,
        { service_id: 'svc-1' },
        USER,
      );

      expect(mockAuth.assertCanManageStaff).toHaveBeenCalledWith(USER.profileId, ORG);
      expect(result).toEqual(created);
    });

    it('throws ConflictException when already authorized', async () => {
      mockDb.providerService.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.authorizeService(ORG, PROFILE, { service_id: 'svc-1' }, USER),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('revokeService', () => {
    it('soft-deletes the provider service record', async () => {
      mockDb.providerService.findFirst.mockResolvedValue({ id: 'ps-1' });
      mockDb.providerService.updateMany.mockResolvedValue({ count: 1 });

      await service.revokeService(ORG, PROFILE, 'svc-1', USER);

      expect(mockDb.providerService.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ is_deleted: true }),
        }),
      );
    });

    it('throws NotFoundException when record does not exist', async () => {
      mockDb.providerService.findFirst.mockResolvedValue(null);

      await expect(
        service.revokeService(ORG, PROFILE, 'missing', USER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createPriceOverride', () => {
    it('creates a price override', async () => {
      mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
      const created = { id: 'ppo-1', price: 200, currency: 'EGP' };
      mockDb.providerPriceOverride.create.mockResolvedValue(created);

      const result = await service.createPriceOverride(
        ORG,
        PROFILE,
        { service_id: 'svc-1', price: 200, currency: 'EGP' },
        USER,
      );

      expect(mockAuth.assertCanManageStaff).toHaveBeenCalledWith(USER.profileId, ORG);
      expect(result).toEqual(created);
    });

    it('throws ConflictException when override already exists', async () => {
      mockDb.providerPriceOverride.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createPriceOverride(
          ORG,
          PROFILE,
          { service_id: 'svc-1', price: 300, currency: 'EGP' },
          USER,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updatePriceOverride', () => {
    it('updates the override', async () => {
      const override = { id: 'ppo-1', organization_id: ORG, profile_id: PROFILE };
      mockDb.providerPriceOverride.findFirst.mockResolvedValue(override);
      mockDb.providerPriceOverride.update.mockResolvedValue({ ...override, price: 250 });

      const result = await service.updatePriceOverride(ORG, PROFILE, 'ppo-1', { price: 250 }, USER);

      expect(result.price).toBe(250);
    });

    it('throws NotFoundException when override not found', async () => {
      mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePriceOverride(ORG, PROFILE, 'missing', { price: 100 }, USER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removePriceOverride', () => {
    it('soft-deletes the override', async () => {
      mockDb.providerPriceOverride.findFirst.mockResolvedValue({ id: 'ppo-1' });
      mockDb.providerPriceOverride.update.mockResolvedValue({});

      await service.removePriceOverride(ORG, PROFILE, 'ppo-1', USER);

      expect(mockDb.providerPriceOverride.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ is_deleted: true }),
        }),
      );
    });

    it('throws NotFoundException when override not found', async () => {
      mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);

      await expect(
        service.removePriceOverride(ORG, PROFILE, 'missing', USER),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
