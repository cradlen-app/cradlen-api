import { computePregnancyDating } from './pregnancy-dating.util.js';

describe('computePregnancyDating', () => {
  const now = new Date('2026-06-20T00:00:00Z');

  it('uses ultrasound dating when present (anchor + GA-at-scan)', () => {
    // Scan on 2026-04-25 read 6w0d; 56 days later (8 weeks) => 14w0d today.
    const result = computePregnancyDating(
      {
        lmp: new Date('2026-03-01T00:00:00Z'),
        us_dating_date: new Date('2026-04-25T00:00:00Z'),
        us_ga_weeks: 6,
        us_ga_days: 0,
      },
      now,
    );
    expect(result.gestationalAgeWeeks).toBe(14);
    expect(result.gestationalAgeDays).toBe(0);
    // EDD = dating date + (280 - 42) days = 2026-04-25 + 238 days.
    expect(result.estimatedDueDate?.toISOString().slice(0, 10)).toBe(
      '2026-12-19',
    );
  });

  it('falls back to LMP + 280 days (Naegele) when no ultrasound dating', () => {
    // LMP 2026-03-28 => 84 days to 2026-06-20 => 12w0d; EDD = LMP + 280d.
    const result = computePregnancyDating(
      {
        lmp: new Date('2026-03-28T00:00:00Z'),
        us_dating_date: null,
        us_ga_weeks: null,
        us_ga_days: null,
      },
      now,
    );
    expect(result.gestationalAgeWeeks).toBe(12);
    expect(result.gestationalAgeDays).toBe(0);
    expect(result.estimatedDueDate?.toISOString().slice(0, 10)).toBe(
      '2027-01-02',
    );
  });

  it('returns all-null when no dating anchor is recorded', () => {
    expect(
      computePregnancyDating(
        { lmp: null, us_dating_date: null, us_ga_weeks: null, us_ga_days: null },
        now,
      ),
    ).toEqual({
      gestationalAgeWeeks: null,
      gestationalAgeDays: null,
      estimatedDueDate: null,
    });
  });

  it('splits a non-week-aligned gestational age into weeks + days', () => {
    // Scan 2026-06-13 (7 days ago) at 11w2d => 12w2d today.
    const result = computePregnancyDating(
      {
        lmp: null,
        us_dating_date: new Date('2026-06-13T00:00:00Z'),
        us_ga_weeks: 11,
        us_ga_days: 2,
      },
      now,
    );
    expect(result.gestationalAgeWeeks).toBe(12);
    expect(result.gestationalAgeDays).toBe(2);
  });
});
