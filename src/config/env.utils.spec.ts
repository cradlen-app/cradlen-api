import { parseList, parsePositiveInt, requireEnv } from './env.utils.js';

describe('env.utils', () => {
  const ENV_KEY = 'ENV_UTILS_TEST_VAR';
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  describe('parsePositiveInt', () => {
    it('parses a valid positive integer from the environment', () => {
      process.env[ENV_KEY] = '42';
      expect(parsePositiveInt(ENV_KEY, '7')).toBe(42);
    });

    it('falls back when the variable is unset', () => {
      delete process.env[ENV_KEY];
      expect(parsePositiveInt(ENV_KEY, '7')).toBe(7);
    });

    it('throws on zero', () => {
      process.env[ENV_KEY] = '0';
      expect(() => parsePositiveInt(ENV_KEY, '7')).toThrow(
        `${ENV_KEY} must be a positive integer`,
      );
    });

    it('throws on a negative value', () => {
      process.env[ENV_KEY] = '-3';
      expect(() => parsePositiveInt(ENV_KEY, '7')).toThrow(
        `${ENV_KEY} must be a positive integer`,
      );
    });

    it('throws on a non-integer value', () => {
      process.env[ENV_KEY] = 'abc';
      expect(() => parsePositiveInt(ENV_KEY, '7')).toThrow(
        `${ENV_KEY} must be a positive integer`,
      );
    });
  });

  describe('requireEnv', () => {
    it('returns the value when set', () => {
      process.env[ENV_KEY] = 'present';
      expect(requireEnv(ENV_KEY)).toBe('present');
    });

    it('throws when unset', () => {
      delete process.env[ENV_KEY];
      expect(() => requireEnv(ENV_KEY)).toThrow(`${ENV_KEY} is not set`);
    });

    it('throws when empty', () => {
      process.env[ENV_KEY] = '';
      expect(() => requireEnv(ENV_KEY)).toThrow(`${ENV_KEY} is not set`);
    });
  });

  describe('parseList', () => {
    it('splits, trims whitespace, and drops empty segments', () => {
      expect(parseList(' en , ar ,, fr ', [])).toEqual(['en', 'ar', 'fr']);
    });

    it('returns the fallback when the raw value is undefined', () => {
      expect(parseList(undefined, ['en', 'ar'])).toEqual(['en', 'ar']);
    });

    it('returns the fallback when the raw value is empty', () => {
      expect(parseList('', ['en'])).toEqual(['en']);
    });
  });
});
