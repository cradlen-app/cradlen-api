// Shared configuration for the Cradlen k6 load-test suite.
//
// Everything is driven by env vars so the same scripts run against localhost
// or production without edits:
//
//   k6 run -e BASE_URL=http://localhost:3000/v1 load-tests/smoke.js
//   k6 run -e BASE_URL=https://api.cradlen.com/v1 load-tests/stress.js
//
// See README.md for the full env-var table and run instructions.

// --- Target -----------------------------------------------------------------

// Default to PRODUCTION per the agreed test plan. Override with -e BASE_URL=...
// for the local dry-run (always smoke-test locally first).
export const BASE_URL = (__ENV.BASE_URL || 'https://api.cradlen.com/v1').replace(
  /\/+$/,
  '',
);

// Shared password for seeded *.test fixtures. For a real (non-seeded) target,
// pass a USERS json (below) carrying per-user passwords instead.
export const PASSWORD = __ENV.TEST_PASSWORD || 'TestPass123!';

// Writes are OFF by default. Only enable against a throwaway test org/branch.
export const WRITE_ENABLED = String(__ENV.WRITE_ENABLED || '').toLowerCase() === 'true';

// --- User pool --------------------------------------------------------------

// The seeded doctor accounts from prisma/seed-fixtures.ts. Doctors can hit every
// read flow below (waiting-list / timeline / history are doctor-scoped).
//
// NOTE: these *.test users exist only where `npm run seed:fixtures` was run.
// They do NOT exist on production. For a production run, supply real load-test
// credentials via -e USERS='[{"email":"...","password":"..."}]'.
const DEFAULT_USERS = [
  'dr.ahmed.hassan@jasmin.test',
  'dr.mervat.fathallah@janah.test',
  'dr.yehia@amshag.test',
  'dr.sabry@amshag.test',
  'dr.esmail@amshag.test',
  'dr.mohamed.elsayed@cradlen.test',
  'amshag.obgyn.1@amshag.test',
  'amshag.obgyn.2@amshag.test',
  'amshag.obgyn.3@amshag.test',
  'amshag.obgyn.4@amshag.test',
].map((email) => ({ email, password: PASSWORD }));

export function getUsers() {
  if (__ENV.USERS) {
    try {
      const parsed = JSON.parse(__ENV.USERS);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((u) => ({ email: u.email, password: u.password || PASSWORD }));
      }
    } catch (e) {
      throw new Error(`USERS env is not valid JSON: ${e}`);
    }
  }
  return DEFAULT_USERS;
}

// --- Common request options -------------------------------------------------

export const REQUEST_TIMEOUT = __ENV.REQUEST_TIMEOUT || '30s';

// --- Thresholds -------------------------------------------------------------
//
// These define what "degraded" means. The abortOnFail thresholds stop the run
// the moment the system crosses a danger line, which is the safety rail for the
// production run AND the signal that we have found the capacity ceiling.
//
// Tune the abort lines to your SLO. Defaults: trip if >5% of requests fail or
// p95 latency blows past 3s for a sustained window.
export const thresholds = {
  http_req_failed: [
    'rate<0.01', // healthy: under 1% errors
    { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' },
  ],
  http_req_duration: [
    'p(95)<800', // healthy: p95 under 800ms
    { threshold: 'p(95)<3000', abortOnFail: true, delayAbortEval: '30s' },
  ],
  // Per-flow login health (the auth slice). Logins are heavier; allow more.
  'http_req_duration{name:login}': ['p(95)<1500'],
  'http_req_duration{name:select_profile}': ['p(95)<1500'],
  checks: ['rate>0.99'],
};
