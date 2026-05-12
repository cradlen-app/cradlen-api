import { evaluate } from './predicate.evaluator';

describe('predicate.evaluator', () => {
  describe('eq', () => {
    it('matches when every key equals exactly', () => {
      expect(
        evaluate(
          { eq: { visitor_type: 'PATIENT' } },
          { visitor_type: 'PATIENT' },
        ),
      ).toBe(true);
    });
    it('fails when any key differs', () => {
      expect(
        evaluate(
          { eq: { visitor_type: 'PATIENT', priority: 'HIGH' } },
          { visitor_type: 'PATIENT', priority: 'LOW' },
        ),
      ).toBe(false);
    });
    it('treats a missing key as undefined (does not match a non-undefined target)', () => {
      expect(evaluate({ eq: { visitor_type: 'PATIENT' } }, {})).toBe(false);
    });
  });

  describe('ne', () => {
    it('matches when every key differs', () => {
      expect(evaluate({ ne: { status: 'CLOSED' } }, { status: 'OPEN' })).toBe(
        true,
      );
    });
    it('fails when any key equals', () => {
      expect(evaluate({ ne: { status: 'CLOSED' } }, { status: 'CLOSED' })).toBe(
        false,
      );
    });
  });

  describe('in', () => {
    it('matches when value is in the list', () => {
      expect(
        evaluate(
          { in: { severity: ['mild', 'moderate'] } },
          { severity: 'moderate' },
        ),
      ).toBe(true);
    });
    it('fails when value is not in the list', () => {
      expect(
        evaluate({ in: { severity: ['mild'] } }, { severity: 'severe' }),
      ).toBe(false);
    });
  });

  describe('and / or', () => {
    it('and: all sub-conditions must hold', () => {
      expect(
        evaluate(
          {
            and: [
              { eq: { visitor_type: 'PATIENT' } },
              { eq: { marital_status: 'MARRIED' } },
            ],
          },
          { visitor_type: 'PATIENT', marital_status: 'MARRIED' },
        ),
      ).toBe(true);
      expect(
        evaluate(
          {
            and: [
              { eq: { visitor_type: 'PATIENT' } },
              { eq: { marital_status: 'MARRIED' } },
            ],
          },
          { visitor_type: 'PATIENT', marital_status: 'SINGLE' },
        ),
      ).toBe(false);
    });

    it('or: at least one sub-condition must hold', () => {
      expect(
        evaluate(
          {
            or: [
              { eq: { severity: 'severe' } },
              { eq: { priority: 'EMERGENCY' } },
            ],
          },
          { severity: 'mild', priority: 'EMERGENCY' },
        ),
      ).toBe(true);
      expect(
        evaluate(
          {
            or: [
              { eq: { severity: 'severe' } },
              { eq: { priority: 'EMERGENCY' } },
            ],
          },
          { severity: 'mild', priority: 'NORMAL' },
        ),
      ).toBe(false);
    });
  });
});
