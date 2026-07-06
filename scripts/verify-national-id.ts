/*
 * End-to-end check of the REAL national_id encryption extension against the dev
 * DB. Proves: read decrypts, exact lookup by plaintext resolves (where-rewrite →
 * blind index), and duplicate national_id is rejected via the bidx unique index.
 *   DATABASE_URL=… FIELD_ENCRYPTION_KEY=… npx tsx scripts/verify-national-id.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { FieldCrypto } from '../src/common/crypto/field-crypto.util.js';
import { nationalIdEncryptionExtension } from '../src/infrastructure/database/national-id.extension.js';

async function main() {
  const url = process.env.DATABASE_URL;
  const key = process.env.FIELD_ENCRYPTION_KEY;
  if (!url || !key) throw new Error('DATABASE_URL and FIELD_ENCRYPTION_KEY required');

  const base = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.split('?')[0], ssl: true }),
  });
  const db = base.$extends(nationalIdEncryptionExtension(new FieldCrypto(key)));
  const fc = new FieldCrypto(key);

  try {
    const raw = await base.$queryRawUnsafe<
      { id: string; national_id: string; national_id_bidx: string }[]
    >(
      'SELECT id, national_id, national_id_bidx FROM patients WHERE is_deleted = false LIMIT 1',
    );
    if (!raw.length) {
      console.log('NO_PATIENTS');
      return;
    }
    const target = raw[0];
    const plaintext = fc.tryDecrypt(target.national_id);

    // 1) Read via the extended client → national_id comes back decrypted.
    const read = await db.patient.findUnique({ where: { id: target.id } });
    const readDecrypts = read?.national_id === plaintext;

    // Diagnostics: does the computed blind index match the stored one, and does a
    // raw bidx lookup resolve?
    const computedBidx = fc.blindIndex(plaintext);
    const bidxMatches = computedBidx === target.national_id_bidx;
    const rawByBidx = await base.$queryRawUnsafe<{ id: string }[]>(
      'SELECT id FROM patients WHERE national_id_bidx = $1',
      computedBidx,
    );

    // 2) Exact lookup by plaintext → extension rewrites to blind index → finds it.
    const found = await db.patient.findFirst({
      where: { national_id: plaintext, is_deleted: false },
    });
    const exactLookupOk = found?.id === target.id && found?.national_id === plaintext;
    console.log(
      JSON.stringify({
        DIAG: true,
        bidx_matches_stored: bidxMatches,
        raw_bidx_lookup_found: rawByBidx.length,
        ext_findFirst_found_id: found?.id ?? null,
        target_id: target.id,
      }),
    );

    // 3) Duplicate national_id rejected by the bidx unique index.
    let uniquenessOk = false;
    try {
      const dup = await db.patient.create({
        data: {
          national_id: plaintext,
          full_name: '__probe__',
          date_of_birth: new Date('2000-01-01'),
          phone_number: '0000000000',
          address: 'probe',
        },
      });
      // Should not reach here; clean up if it did.
      await base.$executeRawUnsafe('DELETE FROM patients WHERE id = $1', dup.id);
    } catch {
      uniquenessOk = true;
    }

    console.log(
      JSON.stringify({
        plaintext_is_digits: /^[0-9]{6,20}$/.test(plaintext),
        read_decrypts: readDecrypts,
        exact_lookup_by_plaintext_ok: exactLookupOk,
        duplicate_rejected: uniquenessOk,
      }),
    );
    console.log(
      readDecrypts && exactLookupOk && uniquenessOk
        ? 'NID_VERIFY_PASS'
        : 'NID_VERIFY_FAIL',
    );
  } finally {
    await base.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
