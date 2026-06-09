import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FinancialAccessService } from './financial-access.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';

const mockDb = { profileJobFunction: { findFirst: jest.fn() } };
const mockPrisma = { db: mockDb };

const ORG = 'org-1';
const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'u1',
  profileId: 'p1',
  organizationId: ORG,
  roles: [],
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
      service.assertIsReceptionistOrOwner(
        ctx({ roles: ['OWNER'], organizationId: ORG }),
        ORG,
      ),
    ).resolves.toBeUndefined();
    // The OWNER short-circuit must not need a DB lookup for its own org.
    expect(mockDb.profileJobFunction.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an OWNER of a DIFFERENT org acting on this org (cross-tenant)', async () => {
    // Token belongs to org-2; path org is org-1. The OWNER role must not leak.
    mockDb.profileJobFunction.findFirst.mockResolvedValue(null);
    await expect(
      service.assertIsReceptionistOrOwner(
        ctx({ roles: ['OWNER'], organizationId: 'org-2' }),
        ORG,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('passes a RECEPTIONIST scoped to the organization', async () => {
    mockDb.profileJobFunction.findFirst.mockResolvedValue({ id: 'jf-1' });
    await expect(
      service.assertIsReceptionistOrOwner(ctx({ roles: ['STAFF'] }), ORG),
    ).resolves.toBeUndefined();
  });

  it('rejects a non-owner non-receptionist', async () => {
    mockDb.profileJobFunction.findFirst.mockResolvedValue(null);
    await expect(
      service.assertIsReceptionistOrOwner(ctx({ roles: ['STAFF'] }), ORG),
    ).rejects.toThrow(BadRequestException);
  });
});
