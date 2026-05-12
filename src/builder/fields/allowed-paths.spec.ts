/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ALLOWED_PATHS,
  InvalidBindingError,
  validateBinding,
} from './allowed-paths';

describe('allowed-paths', () => {
  it('accepts every path declared in ALLOWED_PATHS', () => {
    for (const ns of Object.keys(ALLOWED_PATHS) as Array<
      keyof typeof ALLOWED_PATHS
    >) {
      for (const path of ALLOWED_PATHS[ns]) {
        expect(() => validateBinding(ns as any, path)).not.toThrow();
      }
    }
  });

  it('rejects unknown paths with the legal list in the message', () => {
    expect(() => validateBinding('PATIENT' as any, 'not_a_field')).toThrow(
      InvalidBindingError,
    );
    try {
      validateBinding('PATIENT' as any, 'not_a_field');
    } catch (err) {
      expect((err as Error).message).toContain('full_name');
      expect((err as Error).message).toContain('not_a_field');
    }
  });

  it('treats null path as a no-op (fields can bind by position only)', () => {
    expect(() => validateBinding('PATIENT' as any, null)).not.toThrow();
    expect(() => validateBinding(null, 'anything')).not.toThrow();
    expect(() => validateBinding(undefined, undefined)).not.toThrow();
  });

  it('namespaces have non-empty path lists', () => {
    for (const ns of Object.keys(ALLOWED_PATHS) as Array<
      keyof typeof ALLOWED_PATHS
    >) {
      expect(ALLOWED_PATHS[ns].length).toBeGreaterThan(0);
    }
  });

  it('PATIENT and VISIT namespaces cover the BookVisitDto-required fields', () => {
    // Spot-check the contract for the OB/GYN book-visit template.
    expect(ALLOWED_PATHS.PATIENT).toEqual(
      expect.arrayContaining(['full_name', 'national_id', 'marital_status']),
    );
    expect(ALLOWED_PATHS.VISIT).toEqual(
      expect.arrayContaining([
        'scheduled_at',
        'priority',
        'appointment_type',
        'assigned_doctor_id',
      ]),
    );
    expect(ALLOWED_PATHS.INTAKE).toEqual(
      expect.arrayContaining([
        'chief_complaint',
        'vitals.systolic_bp',
        'vitals.bmi',
      ]),
    );
  });
});
