import { trimesterOrderForGa } from './trimester.util';

describe('trimesterOrderForGa', () => {
  it('returns null for a missing GA', () => {
    expect(trimesterOrderForGa(null)).toBeNull();
  });

  it('bins by completed weeks at the standard boundaries', () => {
    expect(trimesterOrderForGa({ weeks: 0, days: 0 })).toBe(1);
    expect(trimesterOrderForGa({ weeks: 13, days: 6 })).toBe(1); // last day of T1
    expect(trimesterOrderForGa({ weeks: 14, days: 0 })).toBe(2); // first day of T2
    expect(trimesterOrderForGa({ weeks: 27, days: 6 })).toBe(2); // last day of T2
    expect(trimesterOrderForGa({ weeks: 28, days: 0 })).toBe(3); // first day of T3
    expect(trimesterOrderForGa({ weeks: 41, days: 2 })).toBe(3); // post-term still T3
  });
});
