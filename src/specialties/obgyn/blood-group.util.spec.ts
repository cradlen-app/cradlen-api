import { formatBloodGroupRh } from './blood-group.util';

describe('formatBloodGroupRh', () => {
  it('maps every enum code to its template label', () => {
    expect(formatBloodGroupRh('A_POS')).toBe('A+');
    expect(formatBloodGroupRh('A_NEG')).toBe('A−');
    expect(formatBloodGroupRh('B_POS')).toBe('B+');
    expect(formatBloodGroupRh('B_NEG')).toBe('B−');
    expect(formatBloodGroupRh('AB_POS')).toBe('AB+');
    expect(formatBloodGroupRh('AB_NEG')).toBe('AB−');
    expect(formatBloodGroupRh('O_POS')).toBe('O+');
    expect(formatBloodGroupRh('O_NEG')).toBe('O−');
  });

  it('returns null for null/undefined', () => {
    expect(formatBloodGroupRh(null)).toBeNull();
    expect(formatBloodGroupRh(undefined)).toBeNull();
  });

  it('passes an unknown value through unchanged', () => {
    expect(formatBloodGroupRh('A+')).toBe('A+');
    expect(formatBloodGroupRh('XYZ')).toBe('XYZ');
  });
});
