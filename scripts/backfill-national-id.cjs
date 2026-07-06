/*
 * Backfill Patient.national_id encryption. For every patient with a NULL blind
 * index (not yet migrated), encrypts national_id in place and sets
 * national_id_bidx. Idempotent. Crypto format MUST match FieldCrypto
 * (aes-256-gcm, 12-byte iv, `iv.tag.data` base64; blind index = HMAC-SHA256
 * base64 of trim().toLowerCase()).
 *
 *   DATABASE_URL="$(grep '^DATABASE_URL=' .env.development | cut -d= -f2-)" \
 *   FIELD_ENCRYPTION_KEY="$(grep '^FIELD_ENCRYPTION_KEY=' .env.development | cut -d= -f2-)" \
 *   node scripts/backfill-national-id.cjs
 */
const { Client } = require('pg');
const { createCipheriv, createHmac, randomBytes } = require('crypto');

function loadKey() {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) throw new Error('FIELD_ENCRYPTION_KEY not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes (base64)');
  return key;
}
function encrypt(key, plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${data.toString('base64')}`;
}
function blindIndex(key, v) {
  return createHmac('sha256', key).update(v.trim().toLowerCase()).digest('base64');
}

async function main() {
  const key = loadKey();
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL not set');
  const c = new Client({ connectionString: raw.split('?')[0], ssl: true });
  await c.connect();
  try {
    const { rows } = await c.query(
      'SELECT id, national_id FROM patients WHERE national_id_bidx IS NULL',
    );
    let done = 0;
    for (const r of rows) {
      const enc = encrypt(key, r.national_id);
      const bidx = blindIndex(key, r.national_id);
      await c.query(
        'UPDATE patients SET national_id = $1, national_id_bidx = $2 WHERE id = $3',
        [enc, bidx, r.id],
      );
      done++;
    }
    console.log(JSON.stringify({ candidates: rows.length, backfilled: done }));
    console.log('BACKFILL_DONE');
  } finally {
    await c.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
