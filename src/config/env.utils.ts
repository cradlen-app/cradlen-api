/**
 * Shared helpers for reading and validating environment variables inside the
 * `registerAs` config factories. Factories run eagerly at boot, so a missing
 * required var surfaces as a startup error rather than a lazy runtime failure.
 */

export function parsePositiveInt(name: string, fallback: string): number {
  const raw = process.env[name] ?? fallback;
  const value = parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export function parseList(
  raw: string | undefined,
  fallback: string[],
): string[] {
  if (!raw) {
    return fallback;
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
