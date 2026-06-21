// Post-deploy smoke check: assert the deployed API is up and can reach its DB.
// Usage: SMOKE_URL=https://api.example.com node scripts/smoke.mjs
// Falls back to APP_URL, then localhost. Exits non-zero on any failure so it can
// gate a deploy step.
const base = (
  process.env.SMOKE_URL ||
  process.env.APP_URL ||
  'http://localhost:3000'
).replace(/\/+$/, '');
const url = `${base}/v1/health`;
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 10000);

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

try {
  const res = await fetch(url, { signal: controller.signal });
  const body = await res.text();
  if (res.status !== 200) {
    console.error(`SMOKE FAIL: ${url} -> ${res.status}\n${body}`);
    process.exit(1);
  }
  console.log(`SMOKE OK: ${url} -> 200\n${body}`);
  process.exit(0);
} catch (err) {
  console.error(`SMOKE FAIL: ${url} unreachable -> ${String(err)}`);
  process.exit(1);
} finally {
  clearTimeout(timer);
}
