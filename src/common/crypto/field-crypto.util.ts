import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

/**
 * Application-layer field encryption (AES-256-GCM) plus a deterministic blind
 * index (HMAC-SHA256) for exact-match lookup / uniqueness on an encrypted
 * column. Ciphertext is randomized (per-value IV) so it CANNOT be searched or
 * uniquely-constrained directly — the blind index is what you index/unique.
 *
 * Reusable primitive; the `national_id` rollout (encrypt value + blind-index for
 * uniqueness, drop it from fuzzy search) is a staged migration — see
 * docs/security/field-encryption-rollout.md.
 *
 * Ciphertext format: `iv.tag.data` (each base64).
 */
export class FieldCrypto {
  private readonly key: Buffer;

  /** @param keyMaterial base64-encoded 32-byte key (e.g. `openssl rand -base64 32`). */
  constructor(keyMaterial: string) {
    const key = Buffer.from(keyMaterial, 'base64');
    if (key.length !== 32) {
      throw new Error('FIELD_ENCRYPTION_KEY must decode to 32 bytes (base64)');
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${data.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext payload');
    }
    const [ivB, tagB, dataB] = parts;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivB, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    const out = Buffer.concat([
      decipher.update(Buffer.from(dataB, 'base64')),
      decipher.final(),
    ]);
    return out.toString('utf8');
  }

  /**
   * Deterministic keyed hash for equality lookup / uniqueness. Normalizes
   * (trim + lowercase) so equivalent values collide as intended.
   */
  blindIndex(value: string): string {
    return createHmac('sha256', this.key)
      .update(value.trim().toLowerCase())
      .digest('base64');
  }

  /** True if `value` has our `iv.tag.data` (3 non-empty base64 parts) shape. */
  looksEncrypted(value: string): boolean {
    const parts = value.split('.');
    return (
      parts.length === 3 &&
      parts.every((p) => p.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(p))
    );
  }

  /**
   * Decrypts when the value looks like our ciphertext, else returns it as-is.
   * Safe across a transition (legacy plaintext rows, anonymization tombstones).
   */
  tryDecrypt(value: string): string {
    if (!this.looksEncrypted(value)) return value;
    try {
      return this.decrypt(value);
    } catch {
      return value;
    }
  }
}
