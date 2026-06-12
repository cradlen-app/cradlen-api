import { Prisma } from '@prisma/client';

/**
 * Money — Decimal-safe arithmetic for the financial layer.
 *
 * Every monetary column in the schema is `Decimal(10,2)` and surfaces as a
 * `Prisma.Decimal`. NEVER coerce a Decimal to a JS `number` for arithmetic
 * (binary-float rounding silently corrupts currency). These helpers keep all
 * math inside Decimal and are the single sanctioned way the financial modules
 * add / subtract / multiply / compare money.
 */

const Decimal = Prisma.Decimal;

/** Anything that can be turned into a Decimal without precision loss. */
export type DecimalInput = Prisma.Decimal | string | number;

/** Currency scale (minor units) — 2 dp for the currencies we support. */
const SCALE = 2;

export const Money = {
  /** Construct a Decimal from a string/number/Decimal. */
  of(value: DecimalInput): Prisma.Decimal {
    return new Decimal(value);
  },

  zero(): Prisma.Decimal {
    return new Decimal(0);
  },

  add(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
    return new Decimal(a).plus(new Decimal(b));
  },

  subtract(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
    return new Decimal(a).minus(new Decimal(b));
  },

  /** Multiply a unit amount by an (integer) quantity. */
  multiply(amount: DecimalInput, quantity: DecimalInput): Prisma.Decimal {
    return new Decimal(amount).times(new Decimal(quantity));
  },

  /** Divide one amount by another (e.g. a percentage base by 100). */
  divide(amount: DecimalInput, divisor: DecimalInput): Prisma.Decimal {
    return new Decimal(amount).dividedBy(new Decimal(divisor));
  },

  /** Sum a list of amounts; empty list → 0. */
  sum(values: readonly DecimalInput[]): Prisma.Decimal {
    return values.reduce<Prisma.Decimal>(
      (acc, value) => acc.plus(new Decimal(value)),
      new Decimal(0),
    );
  },

  /** -1 if a < b, 0 if equal, 1 if a > b. */
  compare(a: DecimalInput, b: DecimalInput): number {
    return new Decimal(a).comparedTo(new Decimal(b));
  },

  /** The smaller of two amounts. */
  min(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
    const da = new Decimal(a);
    const db = new Decimal(b);
    return da.lessThanOrEqualTo(db) ? da : db;
  },

  /** The larger of two amounts. */
  max(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
    const da = new Decimal(a);
    const db = new Decimal(b);
    return da.greaterThanOrEqualTo(db) ? da : db;
  },

  /** Constrain `value` to the inclusive `[lo, hi]` range. */
  clamp(
    value: DecimalInput,
    lo: DecimalInput,
    hi: DecimalInput,
  ): Prisma.Decimal {
    return this.max(lo, this.min(hi, value));
  },

  equals(a: DecimalInput, b: DecimalInput): boolean {
    return new Decimal(a).equals(new Decimal(b));
  },

  isZero(value: DecimalInput): boolean {
    return new Decimal(value).isZero();
  },

  isNegative(value: DecimalInput): boolean {
    return new Decimal(value).isNegative();
  },

  isPositive(value: DecimalInput): boolean {
    return new Decimal(value).greaterThan(0);
  },

  /** Round to currency scale (default 2 dp, half-up). */
  round(value: DecimalInput, scale: number = SCALE): Prisma.Decimal {
    return new Decimal(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
  },

  /** Fixed-scale string for display/serialization (e.g. "150.00"). */
  format(value: DecimalInput, scale: number = SCALE): string {
    return new Decimal(value).toFixed(scale);
  },

  /**
   * Split `total` across `ratios` so the parts sum back to exactly `total`
   * (no lost or invented minor units). Each share is rounded down to scale and
   * the final bucket absorbs the remainder. Used to apportion a payment across
   * invoice lines / charges.
   */
  allocate(total: DecimalInput, ratios: readonly number[]): Prisma.Decimal[] {
    const totalDecimal = new Decimal(total);
    const ratioSum = ratios.reduce((acc, ratio) => acc + ratio, 0);
    if (ratioSum <= 0) {
      throw new Error('Money.allocate: ratios must sum to a positive number');
    }

    const shares: Prisma.Decimal[] = [];
    let remainder = totalDecimal;
    for (let i = 0; i < ratios.length; i++) {
      const isLast = i === ratios.length - 1;
      if (isLast) {
        shares.push(remainder);
        break;
      }
      const share = totalDecimal
        .times(ratios[i])
        .dividedBy(ratioSum)
        .toDecimalPlaces(SCALE, Decimal.ROUND_DOWN);
      shares.push(share);
      remainder = remainder.minus(share);
    }
    return shares;
  },
};
