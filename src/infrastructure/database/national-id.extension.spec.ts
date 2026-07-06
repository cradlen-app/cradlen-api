import { randomBytes } from 'node:crypto';
import { FieldCrypto } from '@common/crypto/field-crypto.util.js';
import {
  transformWrite,
  rewriteWhere,
  decryptRead,
} from './national-id.extension.js';

const crypto = new FieldCrypto(randomBytes(32).toString('base64'));
const NID = '29901010123456';

describe('national-id extension transforms', () => {
  describe('transformWrite', () => {
    it('encrypts national_id and adds the blind index on create data', () => {
      const data: Record<string, unknown> = {
        national_id: NID,
        full_name: 'x',
      };
      transformWrite(data, crypto);
      expect(data.national_id).not.toBe(NID);
      expect(crypto.tryDecrypt(data.national_id as string)).toBe(NID);
      expect(data.national_id_bidx).toBe(crypto.blindIndex(NID));
    });

    it('handles the update { set } form', () => {
      const data: Record<string, unknown> = { national_id: { set: NID } };
      transformWrite(data, crypto);
      expect((data.national_id as { set: string }).set).not.toBe(NID);
      expect((data.national_id_bidx as { set: string }).set).toBe(
        crypto.blindIndex(NID),
      );
    });

    it('leaves data without national_id untouched', () => {
      const data: Record<string, unknown> = { full_name: 'x' };
      transformWrite(data, crypto);
      expect(data).toEqual({ full_name: 'x' });
    });
  });

  describe('rewriteWhere', () => {
    it('rewrites an exact national_id filter to the blind index', () => {
      const out = rewriteWhere({ national_id: NID, is_deleted: false }, crypto);
      expect(out).toEqual({
        national_id_bidx: crypto.blindIndex(NID),
        is_deleted: false,
      });
    });

    it('drops a partial national_id clause from an OR (fuzzy search)', () => {
      const out = rewriteWhere(
        {
          is_deleted: false,
          OR: [
            { full_name: { contains: 'a' } },
            { national_id: { contains: 'a' } },
            { phone_number: { contains: 'a' } },
          ],
        },
        crypto,
      ) as { OR: unknown[]; is_deleted: boolean };
      expect(out.OR).toHaveLength(2);
      expect(JSON.stringify(out.OR)).not.toContain('national_id');
    });

    it('drops the OR entirely if national_id was its only clause', () => {
      const out = rewriteWhere(
        { OR: [{ national_id: { contains: 'a' } }] },
        crypto,
      );
      expect(out).toEqual({});
    });
  });

  describe('decryptRead', () => {
    it('decrypts national_id in a single row', () => {
      const row = { id: '1', national_id: crypto.encrypt(NID) };
      decryptRead(row, crypto);
      expect(row.national_id).toBe(NID);
    });

    it('decrypts national_id across an array and tolerates plaintext/tombstones', () => {
      const rows = [
        { national_id: crypto.encrypt(NID) },
        { national_id: 'ANON-abc' },
        { national_id: '12345678901234' },
      ];
      decryptRead(rows, crypto);
      expect(rows[0].national_id).toBe(NID);
      expect(rows[1].national_id).toBe('ANON-abc');
      expect(rows[2].national_id).toBe('12345678901234');
    });
  });
});
