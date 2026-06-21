// Authentication + per-session context helpers.
//
// Mirrors the real two-step web flow so results reflect production behaviour:
//   1. POST /auth/login           -> { selection_token, profiles[] }
//   2. POST /auth/profiles/select -> { access_token, ... }
//
// A "session" bundles the access token plus the X-* tenant headers (org /
// profile / branch) derived from the chosen profile, exactly like the web
// client does. It also caches a few patient ids discovered after auth so the
// read flows have real ids to hit.

import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, REQUEST_TIMEOUT } from '../config.js';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'X-Locale': 'en' };

// Step 1: email/password -> selection token + selectable profiles.
export function login(creds) {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: creds.email, password: creds.password }),
    { headers: JSON_HEADERS, tags: { name: 'login' }, timeout: REQUEST_TIMEOUT },
  );
  const ok = check(res, {
    'login 200': (r) => r.status === 200,
    'login has selection_token': (r) => !!r.json('data.selection_token'),
  });
  // Non-fatal: under load a failed login (e.g. 429/5xx) is a data point, not a
  // crash. It is already counted in http_req_failed + checks (which drive the
  // abort thresholds); return null so the VU keeps going.
  if (!ok) return null;
  return {
    selectionToken: res.json('data.selection_token'),
    profiles: res.json('data.profiles') || [],
  };
}

// Pick a profile + its main branch (fall back to first branch).
// Returns null if the user has no usable workspace.
function pickProfileAndBranch(profiles) {
  if (!profiles || profiles.length === 0) return null;
  const profile = profiles[0];
  const branches = profile.branches || [];
  const branch = branches.find((b) => b.is_main) || branches[0];
  if (!branch) return null;
  return { profile, branch };
}

// Step 2: exchange selection token for tenant-scoped tokens.
export function selectProfile(selectionToken, profile, branch) {
  const res = http.post(
    `${BASE_URL}/auth/profiles/select`,
    JSON.stringify({
      selection_token: selectionToken,
      profile_id: profile.profile_id,
      branch_id: branch.branch_id,
    }),
    { headers: JSON_HEADERS, tags: { name: 'select_profile' }, timeout: REQUEST_TIMEOUT },
  );
  const ok = check(res, {
    'select 200': (r) => r.status === 200,
    'select has access_token': (r) => !!r.json('data.access_token'),
  });
  if (!ok) return null;
  return res.json('data.access_token');
}

// Full login -> select. Returns a session with ready-to-use auth headers, or
// null if any step failed (non-fatal — the failure is already recorded in the
// metrics/checks). Callers must handle null.
export function authenticate(creds) {
  const loginResult = login(creds);
  if (!loginResult) return null;
  const picked = pickProfileAndBranch(loginResult.profiles);
  if (!picked) return null;
  const { profile, branch } = picked;
  const accessToken = selectProfile(loginResult.selectionToken, profile, branch);
  if (!accessToken) return null;

  const headers = {
    ...JSON_HEADERS,
    Authorization: `Bearer ${accessToken}`,
    'X-Organization-Id': profile.organization_id,
    'X-Profile-Id': profile.profile_id,
    'X-Branch-Id': branch.branch_id,
  };

  return {
    email: creds.email,
    creds,
    accessToken,
    orgId: profile.organization_id,
    profileId: profile.profile_id,
    branchId: branch.branch_id,
    headers,
    patientIds: [],
    stale: false,
  };
}

// After auth, grab a page of patients so read flows have real ids to hit.
// Failures here are non-fatal (some pools may have no patients yet).
export function discoverPatients(session, limit) {
  const res = http.get(
    `${BASE_URL}/patients?page=1&limit=${limit || 25}`,
    { headers: session.headers, tags: { name: 'discover_patients' }, timeout: REQUEST_TIMEOUT },
  );
  if (res.status === 200) {
    const rows = res.json('data') || [];
    session.patientIds = rows.map((p) => p.id).filter(Boolean);
  }
  return session.patientIds;
}
