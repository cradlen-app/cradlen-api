/*
 * RLS verification under a NON-BYPASS role. `neondb_owner` has rolbypassrls=true,
 * so RLS is ignored for it — the app must run as a dedicated non-bypass role.
 * This creates a temporary `_rls_test` role (NOBYPASSRLS), proves isolation for
 * it through the pooler, then drops the role + throwaway table. No real data.
 *   DATABASE_URL="$(grep '^DATABASE_URL=' .env.development | cut -d= -f2-)" node scripts/rls-probe-role.cjs
 */
const { Client } = require('pg');

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const TEST_PW = 'Probe_pw_temp_9x7q';

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL not set');
  const u = new URL(raw);
  const common = {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: u.pathname.slice(1),
    ssl: true,
  };
  const owner = new Client({
    ...common,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  });
  await owner.connect();
  try {
    await owner.query('DROP TABLE IF EXISTS _rls_probe');
    await owner.query('DROP ROLE IF EXISTS _rls_test');
    await owner.query(
      `CREATE ROLE _rls_test LOGIN PASSWORD '${TEST_PW}' NOBYPASSRLS`,
    );
    await owner.query('GRANT USAGE ON SCHEMA public TO _rls_test');
    await owner.query(
      'CREATE TABLE _rls_probe (id serial primary key, org_id uuid not null, label text)',
    );
    await owner.query(
      "INSERT INTO _rls_probe (org_id,label) VALUES ($1,'a1'),($1,'a2'),($2,'b1')",
      [A, B],
    );
    await owner.query('GRANT SELECT ON _rls_probe TO _rls_test');
    await owner.query('ALTER TABLE _rls_probe ENABLE ROW LEVEL SECURITY');
    await owner.query(
      "CREATE POLICY org_isolation ON _rls_probe USING (org_id::text = current_setting('app.org_id', true))",
    );

    const test = new Client({ ...common, user: '_rls_test', password: TEST_PW });
    await test.connect();
    let labels, noCtxCount;
    try {
      await test.query('BEGIN');
      await test.query("SELECT set_config('app.org_id', $1, true)", [A]);
      const scoped = await test.query('SELECT label FROM _rls_probe ORDER BY label');
      await test.query('COMMIT');
      labels = scoped.rows.map((r) => r.label);

      await test.query('BEGIN');
      const noCtx = await test.query('SELECT label FROM _rls_probe');
      await test.query('COMMIT');
      noCtxCount = noCtx.rows.length;
    } finally {
      await test.end();
    }

    const isolationOk =
      labels.length === 2 && labels.includes('a1') && !labels.includes('b1');
    const noLeak = noCtxCount === 0;
    console.log(
      JSON.stringify({
        role: '_rls_test (NOBYPASSRLS)',
        orgA_labels: labels,
        isolation_ok: isolationOk,
        no_context_rows: noCtxCount,
        no_context_leak_ok: noLeak,
      }),
    );
    console.log(isolationOk && noLeak ? 'RLS_ROLE_PROBE_PASS' : 'RLS_ROLE_PROBE_FAIL');
    if (!(isolationOk && noLeak)) process.exitCode = 1;
  } finally {
    // Revoke the role's privileges before DROP ROLE (a lingering schema/table
    // grant blocks the drop). Table drop first removes its own grants.
    await owner.query('DROP TABLE IF EXISTS _rls_probe').catch(() => {});
    for (const s of [
      'REVOKE USAGE ON SCHEMA public FROM _rls_test',
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM _rls_test',
      'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM _rls_test',
      'DROP ROLE IF EXISTS _rls_test',
    ]) {
      await owner.query(s).catch(() => {});
    }
    await owner.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
