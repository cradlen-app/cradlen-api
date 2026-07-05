import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FinancialAccessService } from './financial-access.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

const mockDb = {
  profile: { findFirst: jest.fn() },
  providerService: { findMany: jest.fn() },
  service: { findMany: jest.fn() },
  cashSession: { findFirst: jest.fn() },
};
const mockPrisma = { db: mockDb };

const ORG = 'org-1';
const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'u1',
  profileId: 'p1',
  organizationId: ORG,
  role: 'STAFF',
  branchIds: [],
  ...over,
});

describe('FinancialAccessService', () => {
  let service: FinancialAccessService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        FinancialAccessService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(FinancialAccessService);
    jest.clearAllMocks();
  });

  it('passes an OWNER acting within their own organization', async () => {
    await expect(
      service.assertCanRunBillingAction(
        ctx({ role: 'OWNER', organizationId: ORG }),
        ORG,
      ),
    ).resolves.toBeUndefined();
    // The OWNER short-circuit must not need a DB lookup for its own org.
    expect(mockDb.profile.findFirst).not.toHaveBeenCalled();
  });

  it('passes a BRANCH_MANAGER within their own organization (branch-scoped per action)', async () => {
    await expect(
      service.assertCanRunBillingAction(
        ctx({ role: 'BRANCH_MANAGER', organizationId: ORG }),
        ORG,
      ),
    ).resolves.toBeUndefined();
    // Like OWNER, the manager passes the role gate without a DB lookup; the
    // per-action assertCanAccessBranch limits them to their branch.
    expect(mockDb.profile.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an OWNER of a DIFFERENT org acting on this org (cross-tenant)', async () => {
    // Token belongs to org-2; path org is org-1. The OWNER role must not leak.
    mockDb.profile.findFirst.mockResolvedValue(null);
    await expect(
      service.assertCanRunBillingAction(
        ctx({ role: 'OWNER', organizationId: 'org-2' }),
        ORG,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('passes a RECEPTIONIST or ACCOUNTANT scoped to the organization', async () => {
    // The job_function `{ code: { in: [...] } }` filter covers both billing roles.
    mockDb.profile.findFirst.mockResolvedValue({ id: 'jf-1' });
    await expect(
      service.assertCanRunBillingAction(ctx({ role: 'STAFF' }), ORG),
    ).resolves.toBeUndefined();
  });

  it('rejects a non-owner without a billing job function', async () => {
    mockDb.profile.findFirst.mockResolvedValue(null);
    await expect(
      service.assertCanRunBillingAction(ctx({ role: 'STAFF' }), ORG),
    ).rejects.toThrow(BadRequestException);
  });

  describe('assertProviderAuthorizedForItems', () => {
    const DOC = 'doc-1';
    const BR = 'br-1';

    it('no-ops when no item carries a service_id (custom lines)', async () => {
      await expect(
        service.assertProviderAuthorizedForItems(ORG, DOC, BR, [
          { description: 'custom' } as never,
          { service_id: null },
        ]),
      ).resolves.toBeUndefined();
      expect(mockDb.providerService.findMany).not.toHaveBeenCalled();
    });

    it('passes when every service is authorized (branch or org-wide)', async () => {
      mockDb.providerService.findMany.mockResolvedValue([
        { service_id: 'svc-a' },
        { service_id: 'svc-b' },
      ]);

      await expect(
        service.assertProviderAuthorizedForItems(ORG, DOC, BR, [
          { service_id: 'svc-a' },
          { service_id: 'svc-b' },
          { service_id: 'svc-a' }, // duplicate collapses
        ]),
      ).resolves.toBeUndefined();

      const where = mockDb.providerService.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        organization_id: ORG,
        profile_id: DOC,
        is_active: true,
        is_deleted: false,
      });
      expect(where.service_id).toEqual({ in: ['svc-a', 'svc-b'] });
      expect(where.OR).toEqual([{ branch_id: BR }, { branch_id: null }]);
      expect(mockDb.service.findMany).not.toHaveBeenCalled();
    });

    it('throws BadRequestException naming the unauthorized services', async () => {
      mockDb.providerService.findMany.mockResolvedValue([
        { service_id: 'svc-a' },
      ]);
      mockDb.service.findMany.mockResolvedValue([
        { name: 'Ultrasound', code: 'US-01' },
      ]);

      await expect(
        service.assertProviderAuthorizedForItems(ORG, DOC, BR, [
          { service_id: 'svc-a' },
          { service_id: 'svc-b' },
        ]),
      ).rejects.toThrow(/Ultrasound \(US-01\)/);

      expect(mockDb.service.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['svc-b'] } },
        select: { name: true, code: true },
      });
    });
  });

  describe('findOpenCashSession', () => {
    it('returns the cashier’s OPEN drawer at the branch', async () => {
      mockDb.cashSession.findFirst.mockResolvedValue({ id: 'sess-1' });

      await expect(
        service.findOpenCashSession(ORG, 'br-1', 'p1'),
      ).resolves.toEqual({ id: 'sess-1' });

      expect(mockDb.cashSession.findFirst).toHaveBeenCalledWith({
        where: {
          organization_id: ORG,
          branch_id: 'br-1',
          profile_id: 'p1',
          status: 'OPEN',
          is_deleted: false,
        },
        select: { id: true },
      });
    });

    it('returns null when the cashier has no open drawer at the branch', async () => {
      mockDb.cashSession.findFirst.mockResolvedValue(null);

      await expect(
        service.findOpenCashSession(ORG, 'br-1', 'p1'),
      ).resolves.toBeNull();
    });
  });
});
