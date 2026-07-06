import { randomBytes } from 'node:crypto';
import { FieldCrypto } from './field-crypto.util.js';

const KEY = randomBytes(32).toString('base64');

describe('FieldCrypto', () => {
  const fc = new FieldCrypto(KEY);

  it('rejects a key that is not 32 bytes', () => {
    expect(() => new FieldCrypto('short')).toThrow(/32 bytes/);
  });

  it('round-trips plaintext', () => {
    const secret = '29901010123456';
    expect(fc.decrypt(fc.encrypt(secret))).toBe(secret);
  });

  it('produces different ciphertext each time (random IV)', () => {
    expect(fc.encrypt('same')).not.toBe(fc.encrypt('same'));
  });

  it('detects tampering via the auth tag', () => {
    const ct = fc.encrypt('value');
    const [iv, tag, data] = ct.split('.');
    const flipped = data.slice(0, -2) + (data.endsWith('AA') ? 'BB' : 'AA');
    expect(() => fc.decrypt(`${iv}.${tag}.${flipped}`)).toThrow();
  });

  it('blind index is deterministic and normalization-insensitive', () => {
    expect(fc.blindIndex('  ABC123 ')).toBe(fc.blindIndex('abc123'));
    expect(fc.blindIndex('a')).not.toBe(fc.blindIndex('b'));
  });
});
