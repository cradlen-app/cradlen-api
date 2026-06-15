# Staff Sign-up Flow — Review, Defects & Test Coverage

**Date:** 2026-06-14
**Scope:** The full staff (owner) sign-up flow across `cradlen-api` (backend)
and `cradlen-web` (frontend): `signup/start → verify → complete`, then
`login → profiles/select`, plus resume/partial-signup handling.

> Patient/guardian self-signup (`patient_accounts`, `/v1/patient-auth/*`) is a
> separate identity space and was **out of scope** here.

---

## 1. Flow as built (reference)

**Backend** (`src/core/auth/`)
- `POST /auth/signup/start` → creates a PENDING `User`, sends OTP, returns a
  `signup_token` (JWT, type `signup`). Reactivates a soft-deleted user (email
  match only) in a transaction; resumes a PENDING user by re-sending the OTP;
  otherwise 409 with `details.fields`.
- `POST /auth/signup/verify` → consumes the OTP, flips the user to ACTIVE +
  `verified_at`, returns a fresh `signup_token`.
- `POST /auth/signup/complete` → in one transaction: atomically claims
  onboarding (`updateMany` guard), creates `Organization` + main `Branch` +
  `Profile` (OWNER) + free-trial `Subscription`, publishes
  `auth.signup.completed`, returns a profile-selection response.
- Login of an incomplete user returns `ONBOARDING_REQUIRED`
  (`VERIFY_OTP` | `COMPLETE_ONBOARDING`); `GET /auth/registration/status`
  reports `NONE | VERIFY_OTP | COMPLETE_ONBOARDING | DONE`.
- OTP: 15-min TTL, 5 attempts, 60s resend cooldown, 5 resends/hr.
  `RegistrationCleanupService` purges PENDING users older than 24h hourly.

**Frontend** (`cradlen-web`)
- Wizard `/sign-up → /sign-up/verify → /sign-up/complete`.
- The `signup_token` lives in an **HttpOnly cookie** and is **stripped from
  every response body** by the Next.js route handlers
  (`src/app/api/auth/signup/*`); the pending email lives in `localStorage`.
- Resume/redirect is driven by `GET /auth/registration/status` via
  `useAuthRedirect` + `getSignupResumePath`.

**Assessment:** The flow is mature and the core logic is sound (transactional
onboarding claim, OTP hardening, token-via-cookie, soft-delete reactivation,
race-safe completion). The issues below are about **test integrity** and a
small **FE/feature gap** — not correctness defects in the runtime path.

---

## 2. Defects found & fixed

### D1 — Five auth integration tests were DORMANT (highest impact) ✅ fixed
The integration runner matches `test/integration/**/*.spec.ts`
(`test/jest-integration.json`). Five files were named `*.int-spec.ts`
(hyphen) — which does **not** match `*.spec.ts` — so they never executed.
Confirmed with `jest --listTests`. Dormant files included the **canonical
signup happy-path** and the **concurrent-onboarding race**.

Resolution:
- Renamed and fixed the **signup-relevant** files; they now run and pass:
  - `signup-full-flow.int.spec.ts` ✅
  - `signup-race.int.spec.ts` ✅
  - `password-reset-reuse.int.spec.ts` ✅ (adjacent auth file, passed as-is)
- All five also had a stale `import * as request from 'supertest'` (namespace
  import — `request` is not callable under this interop); corrected to the
  default import used by the working suites.

### D2 — `auth.controller.spec.ts` constructed the controller with stale arity ✅ fixed
The spec built `new AuthController(signup, sessions, passwordReset)` with 3
args, but the controller now takes **4** (`+ tokensService`). `mintWsTicket`
and `switchBranch` were untested and would have NPE'd. Fixed: injected a
mocked `tokensService` and added delegation tests for the previously untested
endpoints (`signupVerify`, `login`, `selectProfile`, `switchBranch`,
`mintWsTicket`, and the password-reset quartet). 16 tests, all green.

---

## 3. Defects found, NOT fixed (need a separate decision)

### D3 — `refresh-race.int.spec.ts` contradicts the rotation grace window ⚠️ left dormant
After renaming it ran and **failed**: its "a successfully-rotated token cannot
be replayed" test expects a 401, but the implementation now **intentionally**
honors a rotated refresh token for `REFRESH_REUSE_GRACE_MS` (5 min) — see the
documented `SessionsService.REFRESH_REUSE_GRACE_MS`. So the test encodes
pre-grace-window behavior.
**Action needed:** a product/security decision — either (a) update the test to
assert single-additional-use-within-grace semantics, or (b) reconsider whether
indefinite replay within the 5-min window is acceptable (a token honored under
grace is never re-revoked, so it can be replayed repeatedly until the window
elapses). Left as `*.int-spec.ts` (dormant) with the supertest import fixed.

### D4 — `authorization-matrix.int.spec.ts` has a `profiles/select` contract drift ⚠️ left dormant
Its `loginAs` helper selects a profile with
`branch_id: profile.branches[0]?.branch_id` and expects 200 but gets 400
(`branch_id is required`) — the selection-response branch shape it assumes has
drifted. Not signup-scoped; left dormant with the import fixed, flagged for a
focused fix.

### D5 — FE onboarding can't set job function / executive title / engagement ℹ️ noted
`RegisterOrganizationRequest` (`cradlen-web/.../sign-up.types.ts`) omits
`job_function_codes` / `executive_title` / `engagement_type`, although the
backend `complete` DTO accepts them. A founding doctor cannot record their
clinical job function during web signup (it can only be set later). Product
gap, not a runtime defect.

---

## 4. Test coverage added

### Backend — unit (`npx jest src/core/auth`, no DB)
- `signup.service.spec.ts` (+11): `complete` happy path (org+branch+profile+
  subscription created, `auth.signup.completed` published, selection returned);
  `complete` errors (free-plan-not-seeded → 500, OWNER-not-seeded → 500,
  not-verified → 403, no-active-user → 401); `verify` invalid-token / missing
  user; `getRegistrationStatus` invalid-bearer → 401 and no-input → 400.
- `auth.controller.spec.ts`: rewritten (D2) — 16 delegation tests.
- `registration-cleanup.service.spec.ts` (+4): `cleanupStalePendingUsers` —
  24h cutoff, batch draining (500-row loop), no-op when empty, error swallowing.
- `verification-codes.service.spec.ts` (+5): `send` (consume-old → create-new →
  email; transaction path) and `assertCanResend` (cooldown / hourly-cap / pass).

### Backend — integration (`npm run test:integration`, real DB)
- `signup-edge-cases.int.spec.ts` (new, 5): already-verified email → 409
  `details.fields:[email]`; PENDING-resume re-sends OTP with no duplicate user;
  phone-only collision → 409 `[phone_number]` with no token/email; `complete`
  before verify → 403; unknown `job_function_code` → 400 with full transaction
  rollback. (Throttle storage is cleared between tests to avoid the per-IP
  `/start` cap bleeding across cases.)
- Revived `signup-full-flow` + `signup-race` (D1).

### Frontend — vitest
- `src/app/api/auth/signup/{start,verify,complete,resend}/route.test.ts` (new,
  10): signup-token cookie persistence, **token stripped from the JSON body**,
  cookie→backend token injection, the 401 "session expired" guards on
  verify/complete, signup→selection cookie swap on complete, and backend-error
  passthrough.
- `SignUpForm.test.tsx` (new, 5): success → verify step + pending email saved;
  409 phone-only → phone-taken message, no status lookup, no redirect; 409
  email → status-driven resume to verify / sign-in; non-409 → generic error.
- `SignUpVerifyForm.test.tsx` (+8): status-driven redirects
  (COMPLETE_ONBOARDING / DONE); `CODE_EXPIRED` / `MAX_ATTEMPTS_EXCEEDED` /
  generic-400 messages; 401 session-expired screen + start-over; resend success
  + 429 `RESEND_LIMIT_EXCEEDED`.
- `SignUpCompleteForm.test.tsx` (new, 3): single-branch auto-select → dashboard
  route; multi-branch fallback → `/select-profile`; 401 → session-expired error.
- `signup-routing.test.ts` (new, 4): `getSignupResumePath` per step.
- `useAuthRedirect` pure helpers were already well covered — no change.

---

## 5. Verification

- Backend unit: `npx jest src/core/auth` → 11 suites, 143 tests green.
- Backend integration: `npx jest --config test/jest-integration.json test/integration/auth`
  → 9 suites, 31 tests green (needs `test/.env.test` → throwaway Postgres).
- Frontend: `npx vitest run src/features/auth src/app/api/auth/signup`
  → 19 files, 106 tests green.
- Lint clean (`eslint --fix`) on all touched files in both repos.

## 6. Residual risks / follow-ups
1. **D3 refresh-replay** — resolve the grace-window semantics, then re-activate
   `refresh-race`.
2. **D4 authorization-matrix** — fix the `profiles/select` branch assumption,
   then re-activate.
3. **D5** — decide whether web onboarding should capture the founder's job
   function / executive title.
4. Consider a lint/CI guard that rejects `*.int-spec.ts` filenames so the D1
   dormant-test class of bug cannot recur.
