import { Prisma } from '@prisma/client';
import type { FieldCrypto } from '@common/crypto/field-crypto.util.js';

/**
 * Transparent encryption for `Patient.national_id`, applied at the Prisma client
 * layer so no service/DTO code has to change and no read path can be missed:
 *
 *  - WRITE: `national_id` (plaintext) → ciphertext, plus `national_id_bidx`
 *    (deterministic blind index) for uniqueness + exact lookup.
 *  - WHERE: an exact `national_id` filter → `national_id_bidx`; a partial
 *    (`contains`/…) filter is dropped (ciphertext isn't searchable) so fuzzy
 *    search falls back to name/phone.
 *  - READ: `national_id` in results is decrypted (with a plaintext/tombstone
 *    fallback, so mixed data during a backfill is safe).
 *
 * Scoped to the `patient` model. Only wired when `FIELD_ENCRYPTION_KEY` is set.
 */

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function transformWrite(data: unknown, crypto: FieldCrypto): void {
  if (Array.isArray(data)) {
    for (const d of data) transformWrite(d, crypto);
    return;
  }
  if (!isDict(data) || !('national_id' in data)) return;
  const v = data.national_id;
  if (typeof v === 'string') {
    data.national_id = crypto.encrypt(v);
    data.national_id_bidx = crypto.blindIndex(v);
  } else if (isDict(v) && typeof v.set === 'string') {
    data.national_id = { set: crypto.encrypt(v.set) };
    data.national_id_bidx = { set: crypto.blindIndex(v.set) };
  }
}

export function rewriteWhere(where: unknown, crypto: FieldCrypto): unknown {
  if (!isDict(where)) return where;
  const out: Dict = { ...where };

  if ('national_id' in out) {
    const v = out.national_id;
    if (typeof v === 'string') {
      out.national_id_bidx = crypto.blindIndex(v);
      delete out.national_id;
    } else if (isDict(v) && typeof v.equals === 'string') {
      out.national_id_bidx = crypto.blindIndex(v.equals);
      delete out.national_id;
    } else {
      // partial match (contains/startsWith/…) — cannot search ciphertext; drop.
      delete out.national_id;
    }
  }

  for (const key of ['OR', 'AND', 'NOT'] as const) {
    const clause = out[key];
    if (Array.isArray(clause)) {
      const mapped = clause
        .map((c) => rewriteWhere(c, crypto))
        .filter((c) => isDict(c) && Object.keys(c).length > 0);
      if (mapped.length > 0) out[key] = mapped;
      else delete out[key];
    } else if (isDict(clause)) {
      out[key] = rewriteWhere(clause, crypto);
    }
  }
  return out;
}

export function decryptRead(result: unknown, crypto: FieldCrypto): unknown {
  if (Array.isArray(result)) {
    for (const r of result) decryptOne(r, crypto);
    return result;
  }
  decryptOne(result, crypto);
  return result;
}

function decryptOne(row: unknown, crypto: FieldCrypto): void {
  if (isDict(row) && typeof row.national_id === 'string') {
    row.national_id = crypto.tryDecrypt(row.national_id);
  }
}

export function nationalIdEncryptionExtension(crypto: FieldCrypto) {
  return Prisma.defineExtension({
    name: 'national-id-encryption',
    query: {
      patient: {
        async $allOperations({ args, query }) {
          const a = args as Dict;
          if ('where' in a) a.where = rewriteWhere(a.where, crypto);
          if ('data' in a) transformWrite(a.data, crypto);
          if ('create' in a) transformWrite(a.create, crypto);
          if ('update' in a) transformWrite(a.update, crypto);
          const result: unknown = await query(a);
          return decryptRead(result, crypto);
        },
      },
    },
  });
}
