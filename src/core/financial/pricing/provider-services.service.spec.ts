import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProviderServicesService } from './provider-services.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

const mockDb = {
  providerService: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  providerPriceOverride: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  profile: { findFirst: jest.fn() },
  service: { findFirst: jest.fn() },
  $transaction: jest.fn(),
};

const mockPrisma = { db: mockDb };
const mockAuth = {
  assertCanManageStaff: jest.fn(),
  assertCanAccessOrganization: jest.fn(),
};

const ORG = 'org-1';
const PROFILE = 'doc-1';
const USER: AuthContext = {
  userId: 'u1',
  profileId: 'mgr-1',
  organizationId: ORG,
  roles: ['OWNER'],
  branchIds: [],
};

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
    mockAuth.assertCanAccessOrganization.mockResolvedValue(undefined);
    // Default: provider in org + service exists.
    mockDb.profile.findFirst.mockResolvedValue({ id: PROFILE });
    mockDb.service.findFirst.mockResolvedValue({ id: 'svc-1' });
    // Run the $transaction callback against the same mock db.
    mockDb.$transaction.mockImplementation(
      (cb: (tx: typeof mockDb) => unknown) => cb(mockDb),
    );
  });

  describe('authorizeService', () => {
    it('creates a provider service authorization', async () => {
      mockDb.providerService.findFirst.mockResolvedValue(null);
      const created = { id: 'ps-1', service: { id: 'svc-1' } };
      mockDb.providerService.create.mockResolvedValue(created);

      const result = await service.authorizeService(
        ORG,
        PROFILE,
        { service_id: 'svc-1' },
        USER,
      );

      expect(mockAuth.assertCanManageStaff).toHaveBeenCalledWith('mgr-1', ORG);
      expect(result).toEqual(created);
    });

    it('rejects an unknown service', async () => {
      mockDb.service.findFirst.mockResolvedValue(null);
      await expect(
        service.authorizeService(ORG, PROFILE, { service_id: 'bad' }, USER),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a provider not in the org', async () => {
      mockDb.profile.findFirst.mockResolvedValue(null);
      await expect(
        service.authorizeService(ORG, PROFILE, { service_id: 'svc-1' }, USER),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when already authorized', async () => {
      mockDb.providerService.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(
        service.authorizeService(ORG, PROFILE, { service_id: 'svc-1' }, USER),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('authorizeServices', () => {
    it('authorizes multiple services with shared branch and duration', async () => {
      mockDb.providerService.findFirst.mockResolvedValue(null);
      mockDb.providerService.create
        .mockResolvedValueOnce({ id: 'ps-1', service: { id: 'svc-1' } })
        .mockResolvedValueOnce({ id: 'ps-2', service: { id: 'svc-2' } });

      const result = await service.authorizeServices(
        ORG,
        PROFILE,
        {
          service_ids: ['svc-1', 'svc-2'],
          branch_id: 'br-1',
          duration_minutes: 30,
        },
        USER,
      );

      expect(result).toHaveLength(2);
      expect(mockDb.providerService.create).toHaveBeenCalledTimes(2);
      expect(mockDb.providerService.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          service_id: 'svc-1',
          branch_id: 'br-1',
          duration_minutes: 30,
        }),
      );
    });

    it('skips services the provider is already authorized for', async () => {
      mockDb.providerService.findFirst
        .mockResolvedValueOnce({ id: 'existing' }) // svc-1 already authorized
        .mockResolvedValueOnce(null); // svc-2 is new
      mockDb.providerService.create.mockResolvedValue({
        id: 'ps-2',
        service: { id: 'svc-2' },
      });

      const result = await service.authorizeServices(
        ORG,
        PROFILE,
        { service_ids: ['svc-1', 'svc-2'] },
        USER,
      );

      expect(result).toHaveLength(1);
      expect(mockDb.providerService.create).toHaveBeenCalledTimes(1);
      expect(mockDb.providerService.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ service_id: 'svc-2' }),
      );
    });

    it('rejects when one of the services is unknown', async () => {
      mockDb.service.findFirst.mockResolvedValue(null);
      await expect(
        service.authorizeServices(ORG, PROFILE, { service_ids: ['bad'] }, USER),
      ).rejects.toThrow(BadRequestException);
      expect(mockDb.providerService.create).not.toHaveBeenCalled();
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
  });

  describe('createPriceOverride', () => {
    const dto = { service_id: 'svc-1', price: 200, currency: 'EGP' };

    it('creates a price override when the provider is authorized', async () => {
      mockDb.providerService.findFirst.mockResolvedValue({ id: 'ps-1' }); // authorized
      mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
      const created = { id: 'ppo-1', price: 200 };
      mockDb.providerPriceOverride.create.mockResolvedValue(created);

      const result = await service.createPriceOverride(ORG, PROFILE, dto, USER);
      expect(result).toEqual(created);
    });

    it('rejects pricing a service the provider is not authorized for', async () => {
      mockDb.providerService.findFirst.mockResolvedValue(null); // not authorized
      await expect(
        service.createPriceOverride(ORG, PROFILE, dto, USER),
      ).rejects.toThrow(BadRequestException);
      expect(mockDb.providerPriceOverride.create).not.toHaveBeenCalled();
    });

    it('rejects valid_from >= valid_to', async () => {
      await expect(
        service.createPriceOverride(
          ORG,
          PROFILE,
          { ...dto, valid_from: '2026-02-01', valid_to: '2026-01-01' },
          USER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when an override already exists', async () => {
      mockDb.providerService.findFirst.mockResolvedValue({ id: 'ps-1' });
      mockDb.providerPriceOverride.findFirst.mockResolvedValue({
        id: 'existing',
      });
      await expect(
        service.createPriceOverride(ORG, PROFILE, dto, USER),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updatePriceOverride', () => {
    it('updates the override', async () => {
      mockDb.providerPriceOverride.findFirst.mockResolvedValue({ id: 'ppo-1' });
      mockDb.providerPriceOverride.update.mockResolvedValue({
        id: 'ppo-1',
        price: 250,
      });
      const result = await service.updatePriceOverride(
        ORG,
        PROFILE,
        'ppo-1',
        { price: 250 },
        USER,
      );
      expect(result.price).toBe(250);
    });

    it('throws NotFoundException when override not found', async () => {
      mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
      await expect(
        service.updatePriceOverride(
          ORG,
          PROFILE,
          'missing',
          { price: 1 },
          USER,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getProviderService / getPriceOverride', () => {
    it('returns a single authorization', async () => {
      mockDb.providerService.findFirst.mockResolvedValue({ id: 'ps-1' });
      const result = await service.getProviderService(
        ORG,
        PROFILE,
        'svc-1',
        USER,
      );
      expect(result.id).toBe('ps-1');
    });

    it('404s a missing override', async () => {
      mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
      await expect(
        service.getPriceOverride(ORG, PROFILE, 'missing', USER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('activate / deactivate', () => {
    it('deactivates an authorization', async () => {
      mockDb.providerService.findFirst.mockResolvedValue({ id: 'ps-1' });
      mockDb.providerService.update.mockResolvedValue({ id: 'ps-1' });
      await service.setServiceActive(ORG, PROFILE, 'svc-1', false, USER);
      expect(mockDb.providerService.update.mock.calls[0][0].data).toEqual({
        is_active: false,
      });
    });

    it('activates an override', async () => {
      mockDb.providerPriceOverride.findFirst.mockResolvedValue({ id: 'ppo-1' });
      mockDb.providerPriceOverride.update.mockResolvedValue({ id: 'ppo-1' });
      await service.setOverrideActive(ORG, PROFILE, 'ppo-1', true, USER);
      expect(mockDb.providerPriceOverride.update.mock.calls[0][0].data).toEqual(
        {
          is_active: true,
        },
      );
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
  });
});
