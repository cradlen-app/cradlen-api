import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CashSessionStatus, Prisma } from '@prisma/client';
import { CashManagementService } from './cash-management.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

const mockDb = {
  cashSession: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  payment: { findMany: jest.fn() },
};
const mockPrisma = { db: mockDb };
const mockAuth = {
  assertCanAccessBranch: jest.fn(),
  assertCanManageBranch: jest.fn(),
  assertCanManageOrganization: jest.fn(),
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

describe('CashManagementService', () => {
  let service: CashManagementService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CashManagementService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthorizationService, useValue: mockAuth },
        { provide: EventBus, useValue: mockEventBus },
      ],
    }).compile();

    service = module.get(CashManagementService);
    jest.clearAllMocks();
    mockDb.payment.findMany.mockResolvedValue([]);
  });

  type WithSummary = {
    summary: { expected_so_far: Prisma.Decimal; payment_count: number };
  };

  describe('open', () => {
    it('opens a session with a fresh drawer summary when none is open', async () => {
      mockDb.cashSession.findFirst.mockResolvedValue(null);
      mockDb.cashSession.create.mockResolvedValue({
        id: 'cs-1',
        branch_id: BRANCH,
        profile_id: 'p1',
        opening_float: new Prisma.Decimal('100.00'),
      });

      const result = (await service.open(
        ORG,
        { branch_id: BRANCH, opening_float: 100 },
        USER,
      )) as WithSummary;

      expect(mockAuth.assertCanAccessBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        BRANCH,
      );
      expect(mockEventBus.publish.mock.calls[0][0]).toBe('cash_session.opened');
      expect(result.summary.payment_count).toBe(0);
      expect(result.summary.expected_so_far.toFixed(2)).toBe('100.00');
    });

    it('rejects opening a second session (app-level guard)', async () => {
      mockDb.cashSession.findFirst.mockResolvedValue({ id: 'cs-existing' });

      await expect(
        service.open(ORG, { branch_id: BRANCH }, USER),
      ).rejects.toThrow(ConflictException);
    });

    it('maps a P2002 race to a ConflictException', async () => {
      mockDb.cashSession.findFirst.mockResolvedValue(null);
      mockDb.cashSession.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.open(ORG, { branch_id: BRANCH }, USER),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('current', () => {
    it('returns the caller open drawer with a live summary', async () => {
      mockDb.cashSession.findFirst.mockResolvedValue({
        id: 'cs-1',
        branch_id: BRANCH,
        opening_float: new Prisma.Decimal('500.00'),
      });
      mockDb.payment.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal('150.00') },
      ]);

      const result = (await service.current(ORG, BRANCH, USER)) as WithSummary;

      expect(mockAuth.assertCanAccessBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        BRANCH,
      );
      expect(result.summary.payment_count).toBe(1);
      expect(result.summary.expected_so_far.toFixed(2)).toBe('650.00');
    });

    it('returns null when the caller has no open drawer', async () => {
      mockDb.cashSession.findFirst.mockResolvedValue(null);
      expect(await service.current(ORG, BRANCH, USER)).toBeNull();
    });
  });

  describe('getOne', () => {
    it('attaches a live summary for an OPEN session', async () => {
      mockDb.cashSession.findFirst.mockResolvedValue({
        id: 'cs-1',
        status: CashSessionStatus.OPEN,
        branch_id: BRANCH,
        opening_float: new Prisma.Decimal('200.00'),
      });
      mockDb.payment.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal('50.00') },
      ]);

      const result = (await service.getOne(ORG, 'cs-1', USER)) as WithSummary;

      expect(result.summary.expected_so_far.toFixed(2)).toBe('250.00');
    });
  });

  describe('close', () => {
    it('computes expected/variance and closes', async () => {
      mockDb.cashSession.findFirst.mockResolvedValue({
        id: 'cs-1',
        status: CashSessionStatus.OPEN,
        branch_id: BRANCH,
        profile_id: 'p1',
        opening_float: new Prisma.Decimal('100.00'),
      });
      mockDb.payment.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal('150.00') },
        { amount: new Prisma.Decimal('50.00') },
      ]);
      mockDb.cashSession.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({
          id: 'cs-1',
          branch_id: BRANCH,
          profile_id: 'p1',
          ...data,
        }),
      );

      await service.close(ORG, 'cs-1', { counted_amount: 290 }, USER);

      const data = mockDb.cashSession.update.mock.calls[0][0].data;
      // expected = 100 + 150 + 50 = 300; variance = 290 - 300 = -10
      expect(data.expected_amount.toFixed(2)).toBe('300.00');
      expect(data.variance.toFixed(2)).toBe('-10.00');
      expect(data.status).toBe(CashSessionStatus.CLOSED);
      expect(mockEventBus.publish.mock.calls[0][0]).toBe('cash_session.closed');
    });

    it('rejects closing a non-open session', async () => {
      mockDb.cashSession.findFirst.mockResolvedValue({
        id: 'cs-1',
        status: CashSessionStatus.CLOSED,
        branch_id: BRANCH,
        profile_id: 'p1',
      });

      await expect(
        service.close(ORG, 'cs-1', { counted_amount: 100 }, USER),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('reconcile', () => {
    it('reconciles a CLOSED session (manager-gated)', async () => {
      mockDb.cashSession.findFirst.mockResolvedValue({
        id: 'cs-1',
        status: CashSessionStatus.CLOSED,
        branch_id: BRANCH,
      });
      mockDb.cashSession.update.mockResolvedValue({
        id: 'cs-1',
        branch_id: BRANCH,
        status: CashSessionStatus.RECONCILED,
      });

      await service.reconcile(ORG, 'cs-1', USER);

      expect(mockAuth.assertCanManageBranch).toHaveBeenCalledWith(
        'p1',
        ORG,
        BRANCH,
      );
      expect(mockDb.cashSession.update.mock.calls[0][0].data.status).toBe(
        CashSessionStatus.RECONCILED,
      );
    });

    it('rejects reconciling an OPEN session', async () => {
      mockDb.cashSession.findFirst.mockResolvedValue({
        id: 'cs-1',
        status: CashSessionStatus.OPEN,
        branch_id: BRANCH,
      });

      await expect(service.reconcile(ORG, 'cs-1', USER)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
