/* eslint-disable @typescript-eslint/no-explicit-any */
import { assertValidConfig, InvalidConfigError } from './field-config.schema';

describe('field-config.schema', () => {
  it('accepts a fully-namespaced empty config', () => {
    expect(() =>
      assertValidConfig({ ui: {}, validation: {}, logic: {} }, 'field'),
    ).not.toThrow();
  });

  it('accepts partial namespaces (any subset of ui/validation/logic)', () => {
    expect(() => assertValidConfig({ ui: {} }, 'field')).not.toThrow();
    expect(() => assertValidConfig({ logic: {} }, 'field')).not.toThrow();
    expect(() => assertValidConfig({}, 'field')).not.toThrow();
  });

  it('rejects flat top-level keys to prevent "junk drawer" drift', () => {
    expect(() =>
      assertValidConfig(
        { placeholder: 'enter name', ui: {} } as any,
        'field "x"',
      ),
    ).toThrow(InvalidConfigError);
  });

  it('rejects non-object values for each namespace', () => {
    expect(() =>
      assertValidConfig({ ui: 'string-not-object' as any }, 'field "x"'),
    ).toThrow(InvalidConfigError);
    expect(() => assertValidConfig({ logic: [] as any }, 'field "x"')).toThrow(
      InvalidConfigError,
    );
  });

  it('rejects logic.predicates that is not an array', () => {
    expect(() =>
      assertValidConfig(
        { logic: { predicates: 'not-an-array' as any } },
        'field "x"',
      ),
    ).toThrow(InvalidConfigError);
  });

  it('rejects entirely non-object configs', () => {
    expect(() => assertValidConfig(null, 'field')).toThrow(InvalidConfigError);
    expect(() => assertValidConfig('hi', 'field')).toThrow(InvalidConfigError);
    expect(() => assertValidConfig([], 'field')).toThrow(InvalidConfigError);
  });
});
