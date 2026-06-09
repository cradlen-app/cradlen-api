import { Prisma } from '@prisma/client';
import { Money } from './money.js';

describe('Money', () => {
  it('adds without binary-float drift', () => {
    expect(Money.add('0.1', '0.2').toFixed(2)).toBe('0.30');
  });

  it('subtracts and multiplies', () => {
    expect(Money.subtract('100', '0.01').toFixed(2)).toBe('99.99');
    expect(Money.multiply('19.99', 3).toFixed(2)).toBe('59.97');
  });

  it('sums a list (empty → 0)', () => {
    expect(Money.sum([]).toFixed(2)).toBe('0.00');
    expect(Money.sum(['10', '20.50', '0.50']).toFixed(2)).toBe('31.00');
  });

  it('compares and tests sign', () => {
    expect(Money.compare('10', '20')).toBe(-1);
    expect(Money.compare('20', '20')).toBe(0);
    expect(Money.compare('30', '20')).toBe(1);
    expect(Money.equals('5.00', '5')).toBe(true);
    expect(Money.isZero('0.00')).toBe(true);
    expect(Money.isNegative('-1')).toBe(true);
    expect(Money.isPositive('0.01')).toBe(true);
    expect(Money.isPositive('0')).toBe(false);
  });

  it('rounds half-up to currency scale', () => {
    expect(Money.round('1.005').toFixed(2)).toBe('1.01');
    expect(Money.round('1.004').toFixed(2)).toBe('1.00');
  });

  it('formats to a fixed-scale string', () => {
    expect(Money.format('150')).toBe('150.00');
    expect(Money.format(new Prisma.Decimal('7.5'))).toBe('7.50');
  });

  describe('allocate', () => {
    it('splits exactly with no lost minor units', () => {
      const parts = Money.allocate('100', [1, 1, 1]);
      expect(parts.map((p) => p.toFixed(2))).toEqual([
        '33.33',
        '33.33',
        '33.34',
      ]);
      expect(Money.sum(parts).toFixed(2)).toBe('100.00');
    });

    it('respects weighting', () => {
      const parts = Money.allocate('10', [3, 1]);
      expect(parts.map((p) => p.toFixed(2))).toEqual(['7.50', '2.50']);
    });

    it('rejects non-positive ratio sums', () => {
      expect(() => Money.allocate('10', [0, 0])).toThrow();
    });
  });
});
