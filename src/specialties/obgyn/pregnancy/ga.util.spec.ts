import {
  eddFromLmp,
  eddFromUsDating,
  formatEdd,
  formatGa,
  gaFromLmp,
  gaFromUsDating,
} from './ga.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('ga.util', () => {
  describe('eddFromLmp', () => {
    it('adds 280 days (Naegele)', () => {
      expect(formatEdd(eddFromLmp(d('2026-01-01')))).toBe('2026-10-08');
    });

    it('returns null for a missing LMP', () => {
      expect(eddFromLmp(null)).toBeNull();
      expect(eddFromLmp(undefined)).toBeNull();
    });
  });

  describe('gaFromLmp', () => {
    it('computes weeks + days between LMP and asOf', () => {
      // 45 days = 6w 3d
      expect(gaFromLmp(d('2026-01-01'), d('2026-02-15'))).toEqual({
        weeks: 6,
        days: 3,
      });
    });

    it('is exactly 40w 0d at EDD', () => {
      const lmp = d('2026-01-01');
      const edd = eddFromLmp(lmp)!;
      expect(gaFromLmp(lmp, edd)).toEqual({ weeks: 40, days: 0 });
    });

    it('clamps a pre-LMP asOf to 0w 0d', () => {
      expect(gaFromLmp(d('2026-01-10'), d('2026-01-01'))).toEqual({
        weeks: 0,
        days: 0,
      });
    });

    it('ignores time-of-day (whole UTC days)', () => {
      const lmp = new Date('2026-01-01T23:30:00.000Z');
      const asOf = new Date('2026-01-08T00:15:00.000Z');
      expect(gaFromLmp(lmp, asOf)).toEqual({ weeks: 1, days: 0 });
    });

    it('returns null when either date is missing', () => {
      expect(gaFromLmp(null, d('2026-02-01'))).toBeNull();
      expect(gaFromLmp(d('2026-01-01'), null)).toBeNull();
    });
  });

  describe('US dating', () => {
    it('EDD from US dating accounts for the measured age', () => {
      // Scan on 2026-02-01 measuring 8w0d → conception timeline puts EDD
      // 280-56 = 224 days after the scan = 2026-09-13.
      expect(formatEdd(eddFromUsDating(d('2026-02-01'), 8, 0))).toBe(
        '2026-09-13',
      );
    });

    it('GA from US dating advances from the scan', () => {
      // 8w0d at scan, +14 days later → 10w0d.
      expect(gaFromUsDating(d('2026-02-01'), 8, 0, d('2026-02-15'))).toEqual({
        weeks: 10,
        days: 0,
      });
    });

    it('LMP-EDD and US-EDD agree when US dating matches LMP', () => {
      const lmp = d('2026-01-01');
      // 31 days after LMP = 4w3d on the scan date.
      const eddLmp = formatEdd(eddFromLmp(lmp));
      const eddUs = formatEdd(eddFromUsDating(d('2026-02-01'), 4, 3));
      expect(eddUs).toBe(eddLmp);
    });

    it('returns null when US age fields are both missing', () => {
      expect(eddFromUsDating(d('2026-02-01'), null, null)).toBeNull();
      expect(
        gaFromUsDating(d('2026-02-01'), null, null, d('2026-03-01')),
      ).toBeNull();
    });
  });

  describe('formatGa', () => {
    it('formats as "Xw Yd"', () => {
      expect(formatGa({ weeks: 12, days: 3 })).toBe('12w 3d');
    });
    it('returns null for null', () => {
      expect(formatGa(null)).toBeNull();
    });
  });
});
