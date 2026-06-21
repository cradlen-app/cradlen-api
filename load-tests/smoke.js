// Smoke test — ALWAYS run this first (locally, then prod).
//
// 1 VU, short duration. Verifies the auth flow works and every endpoint in the
// mix returns successfully before any heavy run. If smoke fails, do not run
// stress/soak — fix the script/credentials/target first.
//
//   k6 run -e BASE_URL=http://localhost:3000/v1 load-tests/smoke.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from './config.js';
import {
  getSession,
  meFlow,
  waitingListFlow,
  timelineFlow,
  visitHistoryFlow,
  invoicesFlow,
} from './lib/scenarios.js';

export const options = {
  vus: 1,
  iterations: 1,
  // Smoke must be clean: any failed check or non-2xx fails the run.
  thresholds: {
    checks: ['rate==1.0'],
    http_req_failed: ['rate==0.0'],
  },
};

export default function () {
  // Public health probe first.
  const health = http.get(`${BASE_URL}/health`, { tags: { name: 'health' } });
  check(health, {
    'health 200': (r) => r.status === 200,
    'db up': (r) => r.json('data.services.database') === 'up',
  });

  // Auth + context discovery.
  const session = getSession();
  check(session, {
    'authenticated': (s) => !!(s && s.accessToken),
    'has org/branch': (s) => !!(s && s.orgId && s.branchId),
  });
  if (!session) return; // auth failed; checks above already recorded it

  // Exercise every read endpoint once.
  meFlow(session);
  waitingListFlow(session);
  invoicesFlow(session);
  timelineFlow(session);
  visitHistoryFlow(session);

  sleep(1);
}
