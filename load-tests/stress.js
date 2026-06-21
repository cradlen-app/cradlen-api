// Stress test — find the capacity ceiling ("crackdown" point).
//
// Ramps virtual users through increasing plateaus. Each VU authenticates once
// (token reuse) and then loops the read-dominant mix; ~10% of iterations do a
// fresh full login. The abortOnFail thresholds (in config.js) stop the run the
// instant error rate or p95 latency crosses the danger line — that boundary is
// both the safety rail and the capacity ceiling we are looking for.
//
// The KNEE = the last completed stage where http_req_failed stayed < 1% and
// p(95) stayed under target. Read it off the per-stage timeline + end summary.
//
//   k6 run -e BASE_URL=https://api.cradlen.com/v1 load-tests/stress.js
//
// Tune the ladder with env vars:
//   -e STAGE_SECONDS=120   duration of each plateau (default 120s)
//   -e MAX_VUS=1200        top of the ladder (default 1200)
// Override the whole ladder with -e STAGES='[{"target":50,"duration":"1m"},...]'.

import { sleep } from 'k6';
import { thresholds } from './config.js';
import {
  authenticateAllUsers,
  pickPooledSession,
  readMix,
} from './lib/scenarios.js';
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from './config.js';

const STAGE = __ENV.STAGE_SECONDS ? `${__ENV.STAGE_SECONDS}s` : '120s';
const RAMP = '30s';

// Default ladder: 50 -> 100 -> 200 -> 400 -> 800 -> 1200, plateau at each, ramp down.
const DEFAULT_STAGES = [
  { target: 50, duration: RAMP },
  { target: 50, duration: STAGE },
  { target: 100, duration: RAMP },
  { target: 100, duration: STAGE },
  { target: 200, duration: RAMP },
  { target: 200, duration: STAGE },
  { target: 400, duration: RAMP },
  { target: 400, duration: STAGE },
  { target: 800, duration: RAMP },
  { target: 800, duration: STAGE },
  { target: Number(__ENV.MAX_VUS || 1200), duration: RAMP },
  { target: Number(__ENV.MAX_VUS || 1200), duration: STAGE },
  { target: 0, duration: RAMP },
];

function resolveStages() {
  if (__ENV.STAGES) {
    try {
      return JSON.parse(__ENV.STAGES);
    } catch (e) {
      throw new Error(`STAGES env is not valid JSON: ${e}`);
    }
  }
  return DEFAULT_STAGES;
}

export const options = {
  scenarios: {
    capacity_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: resolveStages(),
      gracefulRampDown: '15s',
    },
  },
  thresholds,
  // Tag this run so results are easy to find in any output backend.
  tags: { test: 'stress' },
};

// Liveness gate + token-pool pre-auth. Authenticating ONCE here (a handful of
// logins) keeps us under the login throttle; VUs then reuse these tokens so the
// ramp measures read capacity, not the login limiter. Raise the GLOBAL throttle
// via env so reads aren't capped: -e (server) THROTTLE_LIMIT=100000000.
export function setup() {
  const res = http.get(`${BASE_URL}/health`, { tags: { name: 'health' } });
  const healthy = check(res, {
    'target healthy before ramp': (r) =>
      r.status === 200 && r.json('data.services.database') === 'up',
  });
  if (!healthy) {
    throw new Error(`Target ${BASE_URL} is not healthy; aborting stress run.`);
  }
  const pool = authenticateAllUsers();
  if (pool.length === 0) {
    throw new Error(
      'No users could authenticate (login throttled or bad creds?). ' +
        'Restart the API to reset in-memory throttle counters, then retry.',
    );
  }
  return { startedAt: new Date().toISOString(), poolSize: pool.length, pool };
}

export default function (data) {
  const session = pickPooledSession(data.pool);
  readMix(session);
  // Small think-time so a VU models a user, not a tight loop.
  sleep(Math.random() * 1 + 0.5);
}
