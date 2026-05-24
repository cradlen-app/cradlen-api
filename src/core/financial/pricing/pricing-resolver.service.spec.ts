import { Test } from '@nestjs/testing';
import { Prisma, PricingSource } from '@prisma/client';
import { PricingResolverService } from './pricing-resolver.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

const mockDb = {
  providerPriceOverride: { findFirst: jest.fn() },
  priceListItem: { findFirst: jest.fn() },
};

const mockPrisma = { db: mockDb };

describe('PricingResolverService', () => {
  let resolver: PricingResolverService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PricingResolverService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    resolver = module.get(PricingResolverService);
    jest.clearAllMocks();
  });

  const base = { organizationId: 'org-1', branchId: 'branch-1', serviceId: 'svc-1' };

  it('returns PROVIDER_OVERRIDE when an active override exists', async () => {
    mockDb.providerPriceOverride.findFirst.mockResolvedValue({
      price: new Prisma.Decimal('150.00'),
      currency: 'EGP',
    });

    const result = await resolver.resolvePrice({ ...base, profileId: 'doc-1' });

    expect(result).toEqual({ price: new Prisma.Decimal('150.00'), currency: 'EGP', source: PricingSource.PROVIDER_OVERRIDE });
    expect(mockDb.priceListItem.findFirst).not.toHaveBeenCalled();
  });

  it('falls through to BRANCH_OVERRIDE when no provider override', async () => {
    mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
    mockDb.priceListItem.findFirst.mockResolvedValueOnce({
      unit_price: new Prisma.Decimal('120.00'),
      price_list: { currency: 'EGP' },
    });

    const result = await resolver.resolvePrice({ ...base, profileId: 'doc-1' });

    expect(result?.source).toBe(PricingSource.BRANCH_OVERRIDE);
    expect(result?.price).toEqual(new Prisma.Decimal('120.00'));
  });

  it('falls through to ORG_PRICE_LIST when no branch item', async () => {
    mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
    mockDb.priceListItem.findFirst
      .mockResolvedValueOnce(null) // branch miss
      .mockResolvedValueOnce({ unit_price: new Prisma.Decimal('100.00'), price_list: { currency: 'EGP' } });

    const result = await resolver.resolvePrice({ ...base, profileId: 'doc-1' });

    expect(result?.source).toBe(PricingSource.ORG_PRICE_LIST);
  });

  it('returns null when no pricing found at any level', async () => {
    mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
    mockDb.priceListItem.findFirst.mockResolvedValue(null);

    const result = await resolver.resolvePrice(base);

    expect(result).toBeNull();
  });

  it('skips provider override lookup when profileId is absent', async () => {
    mockDb.priceListItem.findFirst.mockResolvedValue({
      unit_price: new Prisma.Decimal('100.00'),
      price_list: { currency: 'EGP' },
    });

    const result = await resolver.resolvePrice(base); // no profileId

    expect(result).toEqual({ price: new Prisma.Decimal('100.00'), currency: 'EGP', source: PricingSource.BRANCH_OVERRIDE });
    expect(mockDb.providerPriceOverride.findFirst).not.toHaveBeenCalled();
  });
});
