/*
 * RLS pooler probe. Verifies that transaction-scoped `set_config('app.*', …, true)`
 * enforces a row-level-security policy through the Neon pooler — the one thing a
 * local build can't prove. Uses a THROWAWAY table (`_rls_probe`) and drops it;
 * touches no real data. Run:
 *   DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" node scripts/rls-probe.cjs
 */
const { Client } = require('pg');

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL not set');
  const base = raw.split('?')[0]; // drop sslmode/channel_binding; set ssl explicitly
  // Neon serves a publicly-trusted cert — keep TLS verification ON.
  const c = new Client({ connectionString: base, ssl: true });
  await c.connect();
  try {
    await c.query('DROP TABLE IF EXISTS _rls_probe');
    await c.query(
      'CREATE TABLE _rls_probe (id serial primary key, org_id uuid not null, label text)',
    );
    await c.query(
      "INSERT INTO _rls_probe (org_id,label) VALUES ($1,'a1'),($1,'a2'),($2,'b1')",
      [A, B],
    );
    await c.query('ALTER TABLE _rls_probe ENABLE ROW LEVEL SECURITY');
    await c.query('ALTER TABLE _rls_probe FORCE ROW LEVEL SECURITY');
    await c.query(
      "CREATE POLICY org_isolation ON _rls_probe USING (org_id::text = current_setting('app.org_id', true))",
    );

    // 1) With org A bound in the transaction → only A's rows.
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.org_id', $1, true)", [A]);
    const scoped = await c.query('SELECT label FROM _rls_probe ORDER BY label');
    await c.query('COMMIT');

    // 2) New transaction, no context → policy hides everything (set_config was local).
    await c.query('BEGIN');
    const noCtx = await c.query('SELECT label FROM _rls_probe');
    await c.query('COMMIT');

    const labels = scoped.rows.map((r) => r.label);
    const isolationOk =
      labels.length === 2 &&
      labels.includes('a1') &&
      labels.includes('a2') &&
      !labels.includes('b1');
    const noLeak = noCtx.rows.length === 0;

    console.log(
      JSON.stringify({
        orgA_labels: labels,
        isolation_ok: isolationOk,
        no_context_rows: noCtx.rows.length,
        no_context_leak_ok: noLeak,
      }),
    );
    if (isolationOk && noLeak) console.log('RLS_PROBE_PASS');
    else {
      console.log('RLS_PROBE_FAIL');
      process.exitCode = 1;
    }
  } finally {
    await c.query('DROP TABLE IF EXISTS _rls_probe').catch(() => {});
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
