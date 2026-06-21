// Traffic flows + the weighted mix that drives the load tests.
//
// Each flow hits one of the heaviest read endpoints, tagged so the k6 summary
// breaks latency/error rate down per endpoint. A VU-local session is cached and
// transparently re-authenticated on 401 (tokens expire after ~30m, so this
// matters for the soak run).

import http from 'k6/http';
import { check, group } from 'k6';
import { BASE_URL, REQUEST_TIMEOUT, WRITE_ENABLED, getUsers } from '../config.js';
import { authenticate, discoverPatients } from './auth.js';

const USERS = getUsers();

// One cached session per VU. Re-auth happens lazily when missing or stale.
let vuSession = null;

export function getSession() {
  if (vuSession && !vuSession.stale) return vuSession;
  // Spread VUs deterministically across the user pool.
  const creds = USERS[(__VU - 1) % USERS.length];
  const session = authenticate(creds);
  // authenticate() returns null on failure (e.g. throttled). Don't cache a bad
  // session; the next iteration retries. The failure is already in the metrics.
  if (!session) {
    vuSession = null;
    return null;
  }
  vuSession = session;
  discoverPatients(vuSession);
  return vuSession;
}

function markStaleIfUnauthorized(res) {
  if (res.status === 401 || res.status === 403) {
    if (vuSession) vuSession.stale = true;
  }
}

function checkRead(res, label) {
  const ok = check(res, {
    [`${label} 2xx`]: (r) => r.status >= 200 && r.status < 300,
    // Guard against null bodies: under saturation a request can error with no
    // response (r.status === 0, r.body === null), and r.json() would throw.
    [`${label} has data`]: (r) => {
      if (r.status < 200 || r.status >= 300 || r.body == null) return false;
      try {
        return r.json('data') !== undefined;
      } catch (_e) {
        return false;
      }
    },
  });
  markStaleIfUnauthorized(res);
  return ok;
}

function randomPatientId(session) {
  if (!session.patientIds || session.patientIds.length === 0) return null;
  return session.patientIds[Math.floor(Math.random() * session.patientIds.length)];
}

// --- Read flows -------------------------------------------------------------

export function meFlow(session) {
  group('me', () => {
    const res = http.get(`${BASE_URL}/auth/me`, {
      headers: session.headers,
      tags: { name: 'me' },
      timeout: REQUEST_TIMEOUT,
    });
    checkRead(res, 'me');
  });
}

export function waitingListFlow(session) {
  group('waiting_list', () => {
    const res = http.get(
      `${BASE_URL}/branches/${session.branchId}/visits/my-waiting-list?page=1&limit=20`,
      { headers: session.headers, tags: { name: 'waiting_list' }, timeout: REQUEST_TIMEOUT },
    );
    checkRead(res, 'waiting_list');
  });
}

export function timelineFlow(session) {
  const patientId = randomPatientId(session);
  if (!patientId) return waitingListFlow(session); // fall back if no patients
  group('journey_timeline', () => {
    const res = http.get(
      `${BASE_URL}/patients/${patientId}/journeys/timeline?page=1&limit=5`,
      { headers: session.headers, tags: { name: 'journey_timeline' }, timeout: REQUEST_TIMEOUT },
    );
    checkRead(res, 'journey_timeline');
  });
}

export function visitHistoryFlow(session) {
  const patientId = randomPatientId(session);
  if (!patientId) return meFlow(session);
  group('visit_history', () => {
    const res = http.get(
      `${BASE_URL}/patients/${patientId}/visits/history?page=1&limit=3`,
      { headers: session.headers, tags: { name: 'visit_history' }, timeout: REQUEST_TIMEOUT },
    );
    checkRead(res, 'visit_history');
  });
}

export function invoicesFlow(session) {
  group('invoices_list', () => {
    const res = http.get(
      `${BASE_URL}/organizations/${session.orgId}/invoices?page=1&limit=20`,
      { headers: session.headers, tags: { name: 'invoices_list' }, timeout: REQUEST_TIMEOUT },
    );
    checkRead(res, 'invoices_list');
  });
}

// --- Token-reuse pool (capacity mode) ---------------------------------------
//
// For a single-host capacity test the login endpoint (10/10min per IP) is the
// binding limit, so we must NOT log in under load. Instead setup() authenticates
// the whole pool ONCE and hands the sessions to every VU, which reuse the tokens.
// Reads are not login-throttled, so with the global THROTTLE_LIMIT raised they
// flow freely and we measure real read capacity.

// Called from setup(): authenticate each user once, discover patients, return a
// serializable pool. Nulls (failed logins) are filtered out.
export function authenticateAllUsers() {
  const pool = [];
  for (const creds of USERS) {
    const session = authenticate(creds);
    if (!session) continue;
    discoverPatients(session);
    pool.push(session);
  }
  return pool;
}

// Pick a pooled session for this VU (round-robin). Pool comes from setup() data.
export function pickPooledSession(pool) {
  if (!pool || pool.length === 0) return null;
  return pool[(__VU - 1) % pool.length];
}

// Read-only weighted mix against a pre-authenticated session (no login).
export function readMix(session) {
  if (!session) return;
  const roll = Math.random();
  if (roll < 0.33) {
    waitingListFlow(session);
  } else if (roll < 0.6) {
    timelineFlow(session);
  } else if (roll < 0.82) {
    invoicesFlow(session);
  } else if (roll < 0.92) {
    visitHistoryFlow(session);
  } else {
    meFlow(session);
  }
}

// The "realistic" auth slice: a fresh, full login each time (no token reuse).
export function freshLoginFlow() {
  group('fresh_login', () => {
    const creds = USERS[(__VU - 1) % USERS.length];
    // authenticate() runs its own checks and throws on hard failure.
    authenticate(creds);
  });
}

// --- Optional write flow (OFF by default) -----------------------------------
//
// Booking a visit needs a valid care-path / patient context that is environment
// specific, so we keep this opt-in and require explicit ids. Provide:
//   -e WRITE_ENABLED=true -e WRITE_BODY='{...BookVisitDto json...}'
// and ensure the session's org/branch is a THROWAWAY test tenant.
export function writeFlow(session) {
  if (!WRITE_ENABLED) return;
  const body = __ENV.WRITE_BODY;
  if (!body) return; // nothing to do without an explicit payload
  group('book_visit', () => {
    const res = http.post(`${BASE_URL}/visits/book`, body, {
      headers: session.headers,
      tags: { name: 'book_visit' },
      timeout: REQUEST_TIMEOUT,
    });
    check(res, { 'book_visit 2xx': (r) => r.status >= 200 && r.status < 300 });
    markStaleIfUnauthorized(res);
  });
}

// --- Weighted mix -----------------------------------------------------------
//
// Read-dominant (safe for production). Weights roughly match the plan:
//   waiting_list 30% | timeline 25% | invoices 20% | history+me 15% | login 10%
export function mixedRealisticIteration() {
  const session = getSession();
  // No session this iteration (auth failed/throttled). The failure is already
  // recorded; skip the flows rather than dereference null.
  if (!session) return;
  const roll = Math.random();
  if (roll < 0.3) {
    waitingListFlow(session);
  } else if (roll < 0.55) {
    timelineFlow(session);
  } else if (roll < 0.75) {
    invoicesFlow(session);
  } else if (roll < 0.9) {
    if (Math.random() < 0.5) visitHistoryFlow(session);
    else meFlow(session);
  } else {
    freshLoginFlow();
  }
  // Writes only fire when explicitly enabled; otherwise a no-op.
  writeFlow(session);
}
