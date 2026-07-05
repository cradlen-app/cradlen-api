import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ChargeSource,
  ChargeStatus,
  PricingSource,
  Prisma,
} from '@prisma/client';
import { ChargingService } from './charging.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public.js';
import { PricingResolverService } from '../pricing/pricing-resolver.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

const mockDb = {
  charge: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  service: { findFirst: jest.fn() },
  // capture() persists the charge inside a transaction; run the callback with
  // the same mock client so charge.create assertions keep working.
  $transaction: jest.fn((cb: (tx: typeof mockDb) => unknown) => cb(mockDb)),
};

const mockPrisma = { db: mockDb };
const mockAuth = {
  assertCanAccessBranch: jest.fn(),
  assertCanManageBranch: jest.fn(),
  assertCanManageOrganization: jest.fn(),
};
const mockResolver = { resolvePrice: jest.fn() };
const mockPatientAccess = {
  assertPatientInOrg: jest.fn(),
  assertVisitInOrg: jest.fn(),
};
const mockEventBus = { publish: jest.fn() };

const ORG = 'org-1';
const BRANCH = 'br-1';
const USER: AuthContext = {
  userId: 'u1',
  profileId: 'p1',
  organizationId: ORG,
  roles: ['OWNER'],
  branchIds: [BRANCH],
};

describe('ChargingService', () => {
  let service: ChargingService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ChargingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthorizationService, useValue: mockAuth },
        { provide: PricingResolverService, useValue: mockResolver },
        { provide: PatientAccessService, useValue: mockPatientAccess },
        { provide: EventBus, useValue: mockEventBus },
      ],
    }).compile();

    service = module.get(ChargingService);
    jest.clearAllMocks();
  });

  describe('capture', () => {
    const baseDto = {
      branch_id: BRANCH,
      patient_id: 'pat-1',
      profile_id: 'doc-1',
    };

    it('resolves price from the catalog service and emits charge.captured', async () => {
      mockDb.service.findFirst.mockResolvedValue({ name: 'Consultation' });
      mockResolver.resolvePrice.mockResolvedValue({
        price: new Prisma.Decimal('150.00'),
        currency: 'EGP',
        source: PricingSource.ORG_PRICE_LIST,
      });
      const created = {
        id: 'chg-1',
        organization_id: ORG,
        branch_id: BRANCH,
        patient_id: 'pat-1',
        visit_id: null,
        service_id: 'svc-1',
        unit_price: new Prisma.Decimal('150.00'),
        quantity: 2,
        pricing_source: PricingSource.ORG_PRICE_LIST,
        source: ChargeSource.RECEPTION,
        captured_by_id: 'p1',
      };
      mockDb.charge.create.mockResolvedValue(created);

      const result = await service.capture(
        ORG,
        { ...baseDto, service_id: 'svc-1', quantity: 2 },
        USER,
      );

      expect(mockAuth.assertCanAccessBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        BRANCH,
      );
      expect(mockPatientAccess.assertPatientInOrg).toHaveBeenCalledWith(
        'pat-1',
        USER,
      );
      // description defaults to the service name
      expect(mockDb.charge.create.mock.calls[0][0].data.description).toBe(
        'Consultation',
      );
      expect(result).toBe(created);
      const [eventName, payload] = mockEventBus.publish.mock.calls[0];
      expect(eventName).toBe('charge.captured');
      // amount = unit_price * quantity = 300.00
      expect(payload.amount.toFixed(2)).toBe('300.00');
      expect(payload.source).toBe(ChargeSource.RECEPTION);
      // auto-billing is no longer charging's concern — it fans out via
      // charge.captured and InvoiceAccrualListener bills the case invoice.
    });

    it('forwards referenceDate to price resolution in captureInTx', async () => {
      mockDb.service.findFirst.mockResolvedValue({ name: 'Consultation' });
      mockResolver.resolvePrice.mockResolvedValue({
        price: new Prisma.Decimal('100.00'),
        currency: 'EGP',
        source: PricingSource.ORG_PRICE_LIST,
      });
      const tx = {
        charge: { create: jest.fn().mockResolvedValue({ id: 'chg-tx' }) },
      };
      const refDate = new Date('2026-07-05T00:00:00.000Z');

      await service.captureInTx(
        tx as never,
        ORG,
        { ...baseDto, service_id: 'svc-1', quantity: 1 },
        USER,
        refDate,
      );

      expect(mockResolver.resolvePrice).toHaveBeenCalledWith(
        expect.objectContaining({ referenceDate: refDate }),
      );
    });

    it('resolves ad-hoc capture() with no referenceDate (defaults to now)', async () => {
      mockDb.service.findFirst.mockResolvedValue({ name: 'Consultation' });
      mockResolver.resolvePrice.mockResolvedValue({
        price: new Prisma.Decimal('150.00'),
        currency: 'EGP',
        source: PricingSource.ORG_PRICE_LIST,
      });
      mockDb.charge.create.mockResolvedValue({
        id: 'chg-adhoc',
        unit_price: new Prisma.Decimal('150.00'),
        quantity: 1,
      });

      await service.capture(ORG, { ...baseDto, service_id: 'svc-1' }, USER);

      expect(mockResolver.resolvePrice).toHaveBeenCalledWith(
        expect.objectContaining({ referenceDate: undefined }),
      );
    });

    it('uses an explicit unit_price as CUSTOM and skips resolution', async () => {
      mockDb.charge.create.mockResolvedValue({
        id: 'chg-2',
        organization_id: ORG,
        branch_id: BRANCH,
        patient_id: 'pat-1',
        visit_id: null,
        service_id: null,
        unit_price: new Prisma.Decimal('80.00'),
        quantity: 1,
        pricing_source: PricingSource.CUSTOM,
        captured_by_id: 'p1',
      });

      await service.capture(
        ORG,
        { ...baseDto, description: 'Dressing', unit_price: 80 },
        USER,
      );

      expect(mockResolver.resolvePrice).not.toHaveBeenCalled();
      expect(mockDb.charge.create.mock.calls[0][0].data.pricing_source).toBe(
        PricingSource.CUSTOM,
      );
    });

    const captureRow = (id: string) => ({
      id,
      unit_price: new Prisma.Decimal('50.00'),
      quantity: 1,
    });

    it('defaults source to RECEPTION when the captor is not the rendering provider', async () => {
      mockDb.charge.create.mockResolvedValue(captureRow('chg-3'));
      await service.capture(
        ORG,
        { ...baseDto, description: 'X', unit_price: 50 },
        USER,
      );
      expect(mockDb.charge.create.mock.calls[0][0].data.source).toBe(
        ChargeSource.RECEPTION,
      );
    });

    it('defaults source to DOCTOR when the captor is the rendering provider', async () => {
      mockDb.charge.create.mockResolvedValue(captureRow('chg-4'));
      await service.capture(
        ORG,
        { ...baseDto, profile_id: 'p1', description: 'X', unit_price: 50 },
        USER,
      );
      expect(mockDb.charge.create.mock.calls[0][0].data.source).toBe(
        ChargeSource.DOCTOR,
      );
    });

    it('honors an explicit source over the derived default', async () => {
      mockDb.charge.create.mockResolvedValue(captureRow('chg-5'));
      await service.capture(
        ORG,
        {
          ...baseDto,
          profile_id: 'p1',
          description: 'X',
          unit_price: 50,
          source: ChargeSource.SYSTEM,
        },
        USER,
      );
      expect(mockDb.charge.create.mock.calls[0][0].data.source).toBe(
        ChargeSource.SYSTEM,
      );
    });

    it('throws when neither service_id nor unit_price is provided', async () => {
      await expect(
        service.capture(ORG, { ...baseDto, description: 'X' }, USER),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when no description and no service to derive it from', async () => {
      await expect(
        service.capture(ORG, { ...baseDto, unit_price: 50 }, USER),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('void', () => {
    it('voids a PENDING charge', async () => {
      mockDb.charge.findFirst.mockResolvedValue({
        id: 'chg-1',
        branch_id: BRANCH,
        status: ChargeStatus.PENDING,
      });
      mockDb.charge.update.mockResolvedValue({
        id: 'chg-1',
        status: ChargeStatus.VOID,
      });

      await service.void(ORG, 'chg-1', USER);

      expect(mockAuth.assertCanManageBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        BRANCH,
      );
      expect(mockDb.charge.update.mock.calls[0][0].data.status).toBe(
        ChargeStatus.VOID,
      );
    });

    it('rejects voiding an already-invoiced charge', async () => {
      mockDb.charge.findFirst.mockResolvedValue({
        id: 'chg-1',
        branch_id: BRANCH,
        status: ChargeStatus.INVOICED,
      });

      await expect(service.void(ORG, 'chg-1', USER)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFound for a missing charge', async () => {
      mockDb.charge.findFirst.mockResolvedValue(null);
      await expect(service.void(ORG, 'missing', USER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('writeOff', () => {
    it('writes off a PENDING charge', async () => {
      mockDb.charge.findFirst.mockResolvedValue({
        id: 'chg-1',
        branch_id: BRANCH,
        status: ChargeStatus.PENDING,
      });
      mockDb.charge.update.mockResolvedValue({
        id: 'chg-1',
        status: ChargeStatus.WRITTEN_OFF,
      });

      await service.writeOff(ORG, 'chg-1', USER);

      expect(mockDb.charge.update.mock.calls[0][0].data.status).toBe(
        ChargeStatus.WRITTEN_OFF,
      );
    });
  });

  describe('update', () => {
    it('updates quantity and description on a PENDING charge, freezing unit_price', async () => {
      mockDb.charge.findFirst.mockResolvedValue({
        id: 'chg-1',
        branch_id: BRANCH,
        status: ChargeStatus.PENDING,
      });
      mockDb.charge.update.mockResolvedValue({
        id: 'chg-1',
        quantity: 3,
        description: 'Revised',
      });

      await service.update(
        ORG,
        'chg-1',
        { quantity: 3, description: 'Revised' },
        USER,
      );

      expect(mockAuth.assertCanAccessBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        BRANCH,
      );
      const data = mockDb.charge.update.mock.calls[0][0].data;
      expect(data).toEqual({ quantity: 3, description: 'Revised' });
      expect(data).not.toHaveProperty('unit_price');
      expect(mockEventBus.publish.mock.calls[0][0]).toBe('charge.updated');
    });

    it('rejects an empty patch', async () => {
      await expect(service.update(ORG, 'chg-1', {}, USER)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects updating an invoiced charge', async () => {
      mockDb.charge.findFirst.mockResolvedValue({
        id: 'chg-1',
        branch_id: BRANCH,
        status: ChargeStatus.INVOICED,
      });
      await expect(
        service.update(ORG, 'chg-1', { quantity: 2 }, USER),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('cancel', () => {
    it('cancels a PENDING charge via the VOID path', async () => {
      mockDb.charge.findFirst.mockResolvedValue({
        id: 'chg-1',
        branch_id: BRANCH,
        status: ChargeStatus.PENDING,
      });
      mockDb.charge.update.mockResolvedValue({
        id: 'chg-1',
        status: ChargeStatus.VOID,
      });

      await service.cancel(ORG, 'chg-1', USER);

      expect(mockDb.charge.update.mock.calls[0][0].data.status).toBe(
        ChargeStatus.VOID,
      );
      expect(mockEventBus.publish.mock.calls[0][0]).toBe('charge.voided');
    });
  });

  describe('getByVisit', () => {
    it('returns the visit charges with a pending-total rollup', async () => {
      mockDb.charge.findMany.mockResolvedValue([
        {
          status: ChargeStatus.PENDING,
          unit_price: new Prisma.Decimal('100.00'),
          quantity: 2,
          currency: 'EGP',
        },
        {
          status: ChargeStatus.VOID,
          unit_price: new Prisma.Decimal('50.00'),
          quantity: 1,
          currency: 'EGP',
        },
      ]);

      const result = await service.getByVisit(ORG, 'visit-1', USER);

      expect(mockPatientAccess.assertVisitInOrg).toHaveBeenCalledWith(
        'visit-1',
        USER,
      );
      expect(result.summary.charge_count).toBe(2);
      // only the PENDING charge counts: 100 * 2 = 200, the VOID one is excluded
      expect(result.summary.pending_total.toFixed(2)).toBe('200.00');
    });
  });

  describe('list', () => {
    it('uses branch access check when branch_id is filtered', async () => {
      mockDb.charge.findMany.mockResolvedValue([]);
      mockDb.charge.count.mockResolvedValue(0);

      await service.list(ORG, { branch_id: BRANCH }, 1, 20, USER);

      expect(mockAuth.assertCanAccessBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        BRANCH,
      );
      expect(mockAuth.assertCanManageOrganization).not.toHaveBeenCalled();
    });

    it('requires org management for the unscoped view', async () => {
      mockDb.charge.findMany.mockResolvedValue([]);
      mockDb.charge.count.mockResolvedValue(0);

      await service.list(ORG, { patient_id: 'pat-1' }, 1, 20, USER);

      expect(mockAuth.assertCanManageOrganization).toHaveBeenCalledWith(
        'p1',
        ORG,
      );
    });
  });
});
