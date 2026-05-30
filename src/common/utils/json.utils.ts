/**
 * Narrow a stored JSON column to a plain `Record<string, string>`.
 *
 * Prisma typed JSON columns come back as `JsonValue` (object | array |
 * scalar | null). Section-timestamp maps are written as flat string→string
 * objects, but the column type can't express that — this guard rejects
 * arrays, scalars, and null, returning `null` so callers can fall back to a
 * default (`?? {}`) when they need an empty map.
 */
export function coerceStringRecord(
  value: unknown,
): Record<string, string> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, string>;
  }
  return null;
}
