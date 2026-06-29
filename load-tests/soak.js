// Soak test — hold steady load to surface leaks / drift over time.
//
// Run this AFTER stress.js has identified the knee. Set VUS to ~70% of the
// breaking-point VU count and hold for 30-60 minutes. Watch for: creeping p95
// latency, rising error rate, or Neon connection-pool exhaustion that only
// appears under sustained pressure.
//
//   k6 run -e BASE_URL=https://api.cradlen.com/v1 -e VUS=280 -e DURATION=45m load-tests/soak.js

import { sleep } from 'k6';
import http from 'k6/http';
import { check } from 'k6';
import { thresholds, BASE_URL } from './config.js';
import {
  authenticateAllUsers,
  pickPooledSession,
  readMix,
} from './lib/scenarios.js';

const VUS = Number(__ENV.VUS || 100);
const DURATION = __ENV.DURATION || '30m';

export const options = {
  scenarios: {
    steady_soak: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
  thresholds,
  tags: { test: 'soak' },
};

export function setup() {
  const res = http.get(`${BASE_URL}/health`, { tags: { name: 'health' } });
  const healthy = check(res, {
    'target healthy before soak': (r) =>
      r.status === 200 && r.json('data.services.database') === 'up',
  });
  if (!healthy) {
    throw new Error(`Target ${BASE_URL} is not healthy; aborting soak run.`);
  }
  const pool = authenticateAllUsers();
  if (pool.length === 0) {
    throw new Error(
      'No users could authenticate (login throttled or bad creds?). ' +
        'Restart the API to reset in-memory throttle counters, then retry.',
    );
  }
  // NOTE: reused tokens expire after ~30m. For soaks longer than that, raise
  // JWT_ACCESS_EXPIRATION on the dev server or keep DURATION under 30m.
  return { startedAt: new Date().toISOString(), poolSize: pool.length, pool };
}

export default function (data) {
  const session = pickPooledSession(data.pool);
  readMix(session);
  sleep(Math.random() * 2 + 1); // 1-3s think-time per iteration
}
