import { hhmmToMinutes, minutesToHhmm } from './shift-time.helpers';

describe('hhmmToMinutes', () => {
  it('returns 0 for midnight', () => {
    expect(hhmmToMinutes('00:00')).toBe(0);
  });

  it('returns 540 for 09:00', () => {
    expect(hhmmToMinutes('09:00')).toBe(540);
  });

  it('returns 1439 for 23:59', () => {
    expect(hhmmToMinutes('23:59')).toBe(1439);
  });
});

describe('minutesToHhmm', () => {
  it('returns 00:00 for 0', () => {
    expect(minutesToHhmm(0)).toBe('00:00');
  });

  it('pads single-digit hours', () => {
    expect(minutesToHhmm(540)).toBe('09:00');
  });

  it('handles non-zero minutes', () => {
    expect(minutesToHhmm(1439)).toBe('23:59');
  });

  it('round-trips with hhmmToMinutes', () => {
    for (const t of ['00:00', '07:30', '12:45', '23:59']) {
      expect(minutesToHhmm(hhmmToMinutes(t))).toBe(t);
    }
  });
});
