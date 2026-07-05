import { Test } from '@nestjs/testing';
import { DiscountType, Prisma, PricingSource } from '@prisma/client';
import { PricingResolverService } from './pricing-resolver.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

const mockDb = {
  providerService: { findFirst: jest.fn() },
  providerPriceOverride: { findFirst: jest.fn() },
  priceListItem: { findFirst: jest.fn() },
};

const mockPrisma = { db: mockDb };

const d = (n: string) => new Prisma.Decimal(n);

interface ItemOverrides {
  unit_price?: Prisma.Decimal;
  discount_type?: DiscountType | null;
  discount_value?: Prisma.Decimal | null;
  tiers?: { min_quantity: number; unit_price: Prisma.Decimal }[];
  price_list?: {
    currency: string;
    discount_type: DiscountType | null;
    discount_value: Prisma.Decimal | null;
  };
}

const item = (overrides: ItemOverrides = {}) => ({
  unit_price: d('120.00'),
  discount_type: null,
  discount_value: null,
  tiers: [],
  price_list: { currency: 'EGP', discount_type: null, discount_value: null },
  ...overrides,
});

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

  const base = {
    organizationId: 'org-1',
    branchId: 'branch-1',
    serviceId: 'svc-1',
  };

  describe('doctor override', () => {
    it('returns a flat PROVIDER_OVERRIDE when authorized and a branch override exists', async () => {
      mockDb.providerService.findFirst.mockResolvedValue({ id: 'ps-1' });
      mockDb.providerPriceOverride.findFirst.mockResolvedValueOnce({
        price: d('150.00'),
        currency: 'EGP',
      });

      const result = await resolver.resolvePrice({
        ...base,
        profileId: 'doc-1',
      });

      expect(result?.source).toBe(PricingSource.PROVIDER_OVERRIDE);
      expect(result?.price.toFixed(2)).toBe('150.00');
      expect(result?.discount_amount.toFixed(2)).toBe('0.00');
      // Branch-specific matched first → org-wide lookup not needed.
      expect(mockDb.providerPriceOverride.findFirst).toHaveBeenCalledTimes(1);
      expect(mockDb.priceListItem.findFirst).not.toHaveBeenCalled();
    });

    it('skips the override entirely when the provider is not authorized', async () => {
      mockDb.providerService.findFirst.mockResolvedValue(null); // not authorized
      mockDb.priceListItem.findFirst.mockResolvedValueOnce(item());

      const result = await resolver.resolvePrice({
        ...base,
        profileId: 'doc-1',
      });

      expect(result?.source).toBe(PricingSource.BRANCH_OVERRIDE);
      expect(mockDb.providerPriceOverride.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to the org-wide override when no branch-specific one exists', async () => {
      mockDb.providerService.findFirst.mockResolvedValue({ id: 'ps-1' });
      mockDb.providerPriceOverride.findFirst
        .mockResolvedValueOnce(null) // branch-specific miss
        .mockResolvedValueOnce({ price: d('130.00'), currency: 'EGP' }); // org-wide

      const result = await resolver.resolvePrice({
        ...base,
        profileId: 'doc-1',
      });

      expect(result?.price.toFixed(2)).toBe('130.00');
      expect(mockDb.providerPriceOverride.findFirst).toHaveBeenCalledTimes(2);
    });

    it("does not leak another branch's override — falls through to the list", async () => {
      mockDb.providerService.findFirst.mockResolvedValue({ id: 'ps-1' });
      mockDb.providerPriceOverride.findFirst
        .mockResolvedValueOnce(null) // no override at this branch
        .mockResolvedValueOnce(null); // no org-wide override
      // Price-list lookups run in order: branch offer, branch default, ...
      mockDb.priceListItem.findFirst
        .mockResolvedValueOnce(null) // no in-window branch offer
        .mockResolvedValueOnce(item()); // branch default

      const result = await resolver.resolvePrice({
        ...base,
        profileId: 'doc-1',
      });

      expect(result?.source).toBe(PricingSource.BRANCH_OVERRIDE);
    });
  });

  it('falls through to BRANCH_OVERRIDE', async () => {
    mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
    mockDb.priceListItem.findFirst
      .mockResolvedValueOnce(null) // no in-window branch offer
      .mockResolvedValueOnce(item()); // branch default

    const result = await resolver.resolvePrice({ ...base, profileId: 'doc-1' });

    expect(result?.source).toBe(PricingSource.BRANCH_OVERRIDE);
    expect(result?.price.toFixed(2)).toBe('120.00');
  });

  it('falls through to ORG_PRICE_LIST', async () => {
    mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
    mockDb.priceListItem.findFirst
      .mockResolvedValueOnce(null) // no branch offer
      .mockResolvedValueOnce(null) // no branch default
      .mockResolvedValueOnce(null) // no org offer
      .mockResolvedValueOnce(item({ unit_price: d('100.00') })); // org default

    const result = await resolver.resolvePrice({ ...base, profileId: 'doc-1' });

    expect(result?.source).toBe(PricingSource.ORG_PRICE_LIST);
  });

  it('returns null when nothing matches', async () => {
    mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
    mockDb.priceListItem.findFirst.mockResolvedValue(null);
    expect(await resolver.resolvePrice(base)).toBeNull();
  });

  it('skips provider lookup when profileId absent', async () => {
    mockDb.priceListItem.findFirst.mockResolvedValue(item());
    const result = await resolver.resolvePrice(base);
    expect(result?.source).toBe(PricingSource.BRANCH_OVERRIDE);
    expect(mockDb.providerPriceOverride.findFirst).not.toHaveBeenCalled();
  });

  describe('tiered pricing', () => {
    const tiered = () =>
      item({
        unit_price: d('120.00'),
        tiers: [
          { min_quantity: 5, unit_price: d('90.00') },
          { min_quantity: 10, unit_price: d('80.00') },
        ],
      });

    it('uses the base price below the first tier', async () => {
      mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
      mockDb.priceListItem.findFirst.mockResolvedValueOnce(tiered());
      const result = await resolver.resolvePrice({ ...base, quantity: 2 });
      expect(result?.price.toFixed(2)).toBe('120.00');
    });

    it('picks the highest tier whose min_quantity <= quantity', async () => {
      mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
      mockDb.priceListItem.findFirst.mockResolvedValueOnce(tiered());
      const result = await resolver.resolvePrice({ ...base, quantity: 12 });
      expect(result?.price.toFixed(2)).toBe('80.00');
      expect(result?.base_price.toFixed(2)).toBe('80.00');
    });
  });

  describe('discounts', () => {
    it('applies the list percentage discount', async () => {
      mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
      mockDb.priceListItem.findFirst.mockResolvedValueOnce(
        item({
          unit_price: d('120.00'),
          price_list: {
            currency: 'EGP',
            discount_type: DiscountType.PERCENTAGE,
            discount_value: d('10'),
          },
        }),
      );
      const result = await resolver.resolvePrice(base);
      expect(result?.price.toFixed(2)).toBe('108.00');
      expect(result?.discount_amount.toFixed(2)).toBe('12.00');
    });

    it('item discount overrides list discount', async () => {
      mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
      mockDb.priceListItem.findFirst.mockResolvedValueOnce(
        item({
          unit_price: d('120.00'),
          discount_type: DiscountType.FIXED,
          discount_value: d('20'),
          price_list: {
            currency: 'EGP',
            discount_type: DiscountType.PERCENTAGE,
            discount_value: d('50'),
          },
        }),
      );
      const result = await resolver.resolvePrice(base);
      // FIXED 20 off 120 = 100 (not the list's 50% → 60)
      expect(result?.price.toFixed(2)).toBe('100.00');
    });

    it('combines tier selection then discount', async () => {
      mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
      mockDb.priceListItem.findFirst.mockResolvedValueOnce(
        item({
          unit_price: d('120.00'),
          tiers: [{ min_quantity: 10, unit_price: d('100.00') }],
          discount_type: DiscountType.PERCENTAGE,
          discount_value: d('15'),
        }),
      );
      const result = await resolver.resolvePrice({ ...base, quantity: 10 });
      // tier base 100, 15% off → 85
      expect(result?.price.toFixed(2)).toBe('85.00');
    });
  });

  describe('promotional (offer) price lists', () => {
    beforeEach(() => {
      mockDb.providerPriceOverride.findFirst.mockResolvedValue(null);
    });

    it('prefers an in-window branch offer over the branch default', async () => {
      // The offer lookup (first call) hits, so no default lookup is needed.
      mockDb.priceListItem.findFirst.mockResolvedValueOnce(
        item({ unit_price: d('100.00') }),
      );

      const result = await resolver.resolvePrice(base);

      expect(result?.source).toBe(PricingSource.BRANCH_OVERRIDE);
      expect(result?.price.toFixed(2)).toBe('100.00');
      expect(mockDb.priceListItem.findFirst).toHaveBeenCalledTimes(1);
      // The first pass targets a non-default (offer) list.
      const offerWhere =
        mockDb.priceListItem.findFirst.mock.calls[0][0].where.price_list;
      expect(offerWhere.is_default).toBe(false);
    });

    it('falls back to the default when no offer is in window', async () => {
      mockDb.priceListItem.findFirst
        .mockResolvedValueOnce(null) // branch offer out of window
        .mockResolvedValueOnce(item({ unit_price: d('250.00') })); // branch default

      const result = await resolver.resolvePrice(base);

      expect(result?.source).toBe(PricingSource.BRANCH_OVERRIDE);
      expect(result?.price.toFixed(2)).toBe('250.00');
    });

    it('resolves an org-scoped offer to ORG_PRICE_LIST', async () => {
      mockDb.priceListItem.findFirst
        .mockResolvedValueOnce(null) // branch offer
        .mockResolvedValueOnce(null) // branch default
        .mockResolvedValueOnce(item({ unit_price: d('100.00') })); // org offer

      const result = await resolver.resolvePrice(base);

      expect(result?.source).toBe(PricingSource.ORG_PRICE_LIST);
      expect(result?.price.toFixed(2)).toBe('100.00');
      const orgOfferWhere =
        mockDb.priceListItem.findFirst.mock.calls[2][0].where.price_list;
      expect(orgOfferWhere.is_default).toBe(false);
      expect(orgOfferWhere.branch_id).toBeNull();
    });

    it('only treats date-bounded lists as offers and matches referenceDate', async () => {
      mockDb.priceListItem.findFirst.mockResolvedValue(null);
      const refDate = new Date('2026-07-05T00:00:00.000Z');

      await resolver.resolvePrice({ ...base, referenceDate: refDate });

      const offerWhere =
        mockDb.priceListItem.findFirst.mock.calls[0][0].where.price_list;
      // Must be a dated (promotional) list, not a plain secondary list.
      expect(offerWhere.OR).toEqual([
        { valid_from: { not: null } },
        { valid_to: { not: null } },
      ]);
      // The window is matched against the supplied referenceDate.
      expect(JSON.stringify(offerWhere.AND)).toContain(refDate.toISOString());
    });
  });
});
