import { DiscountType, Prisma } from '@prisma/client';
import { InvoiceCompositionService } from './invoice-composition.service.js';

const d = (n: number) => new Prisma.Decimal(n);

// Pure math methods only — they don't touch the two read dependencies, so the
// constructor is fed nulls.
const service = new InvoiceCompositionService(null as never, null as never);

describe('InvoiceCompositionService.resolveInvoiceDiscount', () => {
  it('returns zero when no discount is declared', () => {
    expect(
      service
        .resolveInvoiceDiscount(d(200), { type: null, value: null })
        .toFixed(2),
    ).toBe('0.00');
  });

  it('applies a PERCENTAGE discount to the subtotal', () => {
    expect(
      service
        .resolveInvoiceDiscount(d(200), {
          type: DiscountType.PERCENTAGE,
          value: d(10),
        })
        .toFixed(2),
    ).toBe('20.00');
  });

  it('applies a FIXED discount as a flat amount', () => {
    expect(
      service
        .resolveInvoiceDiscount(d(200), {
          type: DiscountType.FIXED,
          value: d(30),
        })
        .toFixed(2),
    ).toBe('30.00');
  });

  it('clamps a FIXED discount larger than the subtotal down to the subtotal', () => {
    expect(
      service
        .resolveInvoiceDiscount(d(50), {
          type: DiscountType.FIXED,
          value: d(80),
        })
        .toFixed(2),
    ).toBe('50.00');
  });
});

describe('InvoiceCompositionService.computeTotals', () => {
  it('sums line totals, applies discount + tax, and never goes negative', () => {
    const result = service.computeTotals(
      [{ total_amount: d(100) }, { total_amount: d(50) }],
      { type: DiscountType.PERCENTAGE, value: d(10) },
      d(15),
    );

    // subtotal 150, discount 15 (10%), + tax 15 → total 150
    expect(result.subtotal.toFixed(2)).toBe('150.00');
    expect(result.discountAmount.toFixed(2)).toBe('15.00');
    expect(result.total.toFixed(2)).toBe('150.00');
  });

  it('floors the total at zero when the discount exceeds subtotal + tax', () => {
    const result = service.computeTotals(
      [{ total_amount: d(40) }],
      { type: DiscountType.FIXED, value: d(40) },
      d(0),
    );

    expect(result.total.toFixed(2)).toBe('0.00');
  });
});
