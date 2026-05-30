# Auth Module Code Review — 2026-05-28

**Scope:** `src/core/auth/` (incl. `authorization/`) plus global wiring (`src/common/guards/jwt-auth.guard.ts`, `src/common/decorators/{public,current-user}.decorator.ts`, `src/app.module.ts` APP_GUARD registration, `src/config/auth.config.ts`).
**Depth:** Security-leaning — architecture, clean code, and a deliberate pass over the security surface.
**Reviewer:** Claude (Opus 4.7), pair-reviewed with the human owner.
**Companion artifact:** `auth-refactor-plan.md` — ordered break-up plan derived from these findings.

---

## Executive summary

- **Overall health: good.** The module is well-structured for its size: zero TODO/FIXME, layer boundaries clean, atomic onboarding-claim pattern, JTI-based refresh rotation, type-discriminated JWTs, dedicated secrets per token family, and a 51-test baseline that all passes.
- **Biggest structural smell:** `auth.service.ts` is **1,153 LOC / 20+ public methods** spanning six distinct responsibilities (tokens, verification codes, signup, sessions, password reset, me). It is right at the edge of becoming difficult to evolve safely. Break it up before the next major feature lands.
- **Top security findings worth fixing soon:**
  1. **`forgot-password` email-enumeration oracle** (`auth.service.ts:1041–1043`) — empty `reset_token` reveals whether an email exists. P1.
  2. **Refresh-rotation race** (`auth.service.ts:511–522`) — revoke + re-issue is not atomic; two parallel refreshes can both succeed and produce two valid sessions. P1.
  3. **Dead privileged-role constants** (`authorization.service.ts:5–8`) — `BRANCH_MANAGER` is referenced everywhere but is **not a seeded role**. Half of the authorization model is currently unreachable, and the existing tests pass only because they mock Prisma. P1 (correctness, not just style).
  4. **OTP bcrypt cost inconsistent** (`auth.service.ts:669`) — hardcoded `10` vs project constant `BCRYPT_ROUNDS=12`. P3.
  5. **Reset token re-use after `resetPassword`** (`auth.service.ts:1124–1139`) — the verified reset token still validates after the password has been changed because the `jti` is never persisted. P2.
- **Top clean-code wins:** N+1 in `getMe` (lines 919–935); duplicated resend cooldown logic between `resendOtp` and `resendPasswordResetCode`; pull magic constants into `auth.config.ts`.
- **Testing:** 51 passing, but coverage is mock-heavy and skews to happy paths and a handful of well-chosen negative cases (concurrent claim, phone-only collision). Missing: refresh-token replay, reset-token re-use, throttle-key behavior, JWT type-confusion, JTI rotation race. **No integration tests** under `test/jest-integration.json` cover auth — given that the user memory says "integration tests must hit a real DB" (Q4 prior incident), the absence is itself a P2.

---

## Findings table

Severity legend: **P0** ship-stopper (security or data corruption) · **P1** fix before next release · **P2** fix in normal cadence · **P3** nice-to-have.

| ID | Dim | Sev | File:Line | Finding | Suggested fix |
|---|---|---|---|---|---|
| **S-01** | Sec | P1 | `auth.service.ts:1041–1043` | `forgotPassword` returns `{ reset_token: '', expires_in: 0 }` when email unknown — response shape distinguishes "user exists" from "user does not exist", enabling enumeration. Also a ~hundreds-of-ms timing oracle: existing path runs bcrypt + DB write + Resend roundtrip, missing-user path returns instantly. | Always return a synthetic but well-formed token (e.g. sign a `verified: false` reset token bound to a sentinel `target` and discard on later steps). Match expires_in. Optionally introduce an artificial floor delay via a constant-time async pad. Document the chosen tradeoff. |
| **S-02** | Sec | P1 | `auth.service.ts:511–522` | Refresh-token rotation revokes the old row, then calls `issueTokenPair` outside any transaction. If two refreshes arrive concurrently, both see `is_revoked=false`, both pass the bcrypt check at L505, both call `update`, both call `issueTokenPair` → **two valid sessions** from one refresh token (token theft amplification). | Replace `findUnique` + `update` with a guarded `updateMany({ where: { jti, is_revoked: false }, data: {...} })` and assert `count === 1` before issuing the new pair. Wrap revoke + RefreshToken create in `$transaction`. Consider also marking the row "rotated" rather than "revoked" so reuse of a rotated jti can trigger family-wide revocation (per RFC 6819 §5.2.2.3). |
| **S-03** | Arch | P1 | `authorization.service.ts:5–10` | `BRANCH_MANAGER_ROLES`, `STAFF_MANAGER_ROLES`, `STAFF_VIEWER_ROLES`, `ORG_WIDE_ROLES` all reference `BRANCH_MANAGER`, but Role table only seeds `OWNER`, `STAFF`, `EXTERNAL` (CLAUDE.md, `prisma/seed.ts`). All branch-manager paths are dead in prod yet the unit tests pass because they mock Prisma. This is a **correctness gap**, not just style. | Decide: either seed `BRANCH_MANAGER` and grant it in invitations/onboarding, OR remove the dead constants and collapse the methods. Document the decision in CLAUDE.md "Roles vs. job functions" section. Add an integration test that asserts the seeded role set matches the codebase's role constants. |
| **S-04** | Sec | P2 | `auth.service.ts:1124–1139` | `resetPassword` updates the password and revokes all refresh tokens, but the **verified reset token itself** is not invalidated (no row exists for it — `jti` is on the payload only). A stolen verified reset token replays after the legitimate user has set a new password → attacker overwrites the password. | Persist reset tokens by `jti` (small `PasswordResetToken` table: `jti`, `user_id`, `verified`, `consumed_at`, `expires_at`) and reject if `consumed_at` is set. Alternatively, after successful reset, set `user.password_reset_invalidates_before = now()` and check that claim's iat against it on every reset attempt. |
| **S-05** | Sec | P2 | `auth.controller.ts:144–151, 153–160, 203–210` | `refresh`, `logout`, `reset-password` have **no `@Throttle` override** — they fall back to the global throttler only. Login/forgot/signup paths are throttled at 5–10/10min, but `reset-password` (the actual password mutation) is wide open. | Add `@Throttle({ default: { limit: 5, ttl: 600000 } })` to `reset-password` and `refresh`. `logout` is lower-risk but bound it too. |
| **S-06** | Sec | P2 | `auth.controller.ts` throttle config (all endpoints) | All `@Throttle` use IP only (ThrottlerGuard default). An attacker rotating IPs (or co-tenant cloud egress) bypasses the per-endpoint cap. Email enumeration of `forgot-password` and credential stuffing of `login` are the realistic targets. | Implement a composite throttler keyed by `${ip}:${body.email ?? body.phone}` for login, forgot-password, signup-start, verify-reset-code, signup-verify. NestJS pattern: subclass `ThrottlerGuard` and override `getTracker`. |
| **S-07** | Sec | P3 | `auth.service.ts:669` | `bcrypt.hash(code, 10)` hardcoded; passwords and refresh-token hashes use `BCRYPT_ROUNDS = 12`. Inconsistency; also unnecessary — OTP cost can stay lower if intentional (faster verify) but should be a named constant. | Add `OTP_BCRYPT_ROUNDS = 10` (or unify on 12) and reference it. Move both to `auth.config.ts` as configurable env vars. |
| **S-08** | Sec | P3 | `auth.service.ts:760–777, 779–794` | `signup_token` and `profile_selection` token both use the **access** secret. Today's type-discriminator check (`payload.type !== type`) prevents confusion, but reusing a secret across token families weakens defense-in-depth — a future bug in one decode path could cross-validate. | Either (a) give signup/selection their own secret, or (b) add an `aud` claim (`aud: 'signup' \| 'access' \| 'reset'`) and verify it on every decode. (b) is cheaper. |
| **S-09** | Sec | P3 | `auth.service.ts:1031–1052` | `forgotPassword` only sends OTP if user is `is_active`, `verified_at != null`, and not soft-deleted. Locked/disabled users get the empty-token enumeration response (see S-01) which differs from active. Combined with S-01, an attacker can probe both email existence AND account state. | Bundled into S-01 fix — synthetic response must be identical for all "won't email" cases. |
| **S-10** | Sec | P3 | `jwt.strategy.ts:20–24` | No `issuer` / `audience` claim asserted. JwtModule registered with `JwtModule.register({})` — no global defaults. | Add `issuer: 'cradlen-api'` to every `sign()` and `verify()` call (or set globally via `JwtModule.register({ verifyOptions: { issuer: 'cradlen-api' } })`). Defends against accidental token reuse across sibling services later. |
| **S-11** | Sec | P3 | `auth.service.ts:91–176` (`signupStart` reactivation branch) | Lines 104–127 update the existing soft-deleted user (resetting password, name, registration_status) **outside** any transaction with the verification-code creation. If `sendVerificationCode` throws mid-flight, the user is reactivated with new credentials but cannot finish signup until a manual `resendOtp`. Edge-case; low blast radius. | Wrap user.update + sendVerificationCode write in `$transaction`. Defer the email send to after commit. |
| **S-12** | Sec | P3 | `auth.service.ts` (no row cleanup) | `RefreshToken` rows are never deleted — `is_revoked` flips only. Over time this table grows unbounded; expired+revoked rows older than refresh-expiration are pure clutter and slow refresh lookups. | Extend `RegistrationCleanupService` (or add a sibling cron) to hard-delete `RefreshToken` where `expires_at < NOW() - 30 days` OR `is_revoked = true AND revoked_at < NOW() - 30 days`. |
| **S-13** | Sec | P3 | `app.module.ts:95–104` + grep all callers | `@Public()` is the only opt-out from global JWT auth. Reviewed: `auth.controller.ts` uses it appropriately. **Not audited** for the full codebase in this pass — the earlier grep showed 30+ controllers reference `JwtAuthGuard`/`@Public`/`CurrentUser` but I did not inspect each. | Run a one-shot audit script: `grep -rn '@Public()' src/ | grep -v auth.controller` and confirm every match is intentional. Track output in this report's next revision. |
| **S-14** | Sec | P3 | Logging — pino config (out of scope file) | Auth service does not log secrets directly, but the project-wide pino config is not visible from this scope. If `LOG_LEVEL=trace` ever runs in prod, request bodies (containing passwords/OTPs) may be dumped. | Configure pino's `redact` paths: `req.body.password`, `req.body.refresh_token`, `req.body.reset_token`, `req.body.code`, `req.headers.authorization`. Document in `@infrastructure/logging`. |
| **A-01** | Arch | P1 | `auth.service.ts` (whole file) | 1,153 LOC / 20+ public methods spanning 6 responsibility clusters. Single-responsibility violation; the file is now hard to navigate and the test file mirrors its sprawl. | See `auth-refactor-plan.md` — extract `TokensService`, `VerificationCodesService`, `SignupService`, `SessionsService`, `PasswordResetService`. Leave a thin `AuthService` facade or remove entirely. |
| **A-02** | Arch | P2 | `auth.service.ts:486–522` | `refresh` does not wrap revoke + new-token issuance in a transaction. Linked to S-02 but worth flagging as architecture: the same anti-pattern recurs in `selectProfile` and `switchBranch` indirectly via `issueTokenPair`. | The extracted `TokensService.issueTokenPair` should accept an optional `revokeJti` parameter and execute revoke + create in a single Prisma `$transaction`. |
| **A-03** | Arch | P2 | (entire module) | Auth publishes **zero** EventBus events. Per CLAUDE.md "cross-module communication" — security-relevant events (signup completed, password reset completed, login failed N times) belong on EventBus for downstream audit/notification/SIEM. | After the refactor, emit `auth.signup.completed`, `auth.password.reset.completed`, `auth.login.failed`, `auth.refresh.rotated`. Audit listener writes to a new `AuthAuditLog` table (or pipes to Sentry breadcrumbs). |
| **A-04** | Arch | P2 | `jwt.strategy.ts:32–43` + `authorization.service.ts:16–53` | Every authenticated request runs **3 queries**: (1) user.findFirst (strategy L32), (2) profile.findFirst (authz L22), (3) branch.findMany or profileBranch.findMany (authz L60/66). At p99 traffic this dominates request latency. | Two options: (a) combine (1) and (2) into a single query (`user.findFirst({ include: { profiles: { where: { id } }}})`); (b) cache `AuthContext` per access token (TTL = remaining JWT life) in an in-memory LRU or Redis. (a) is the easy win — defer (b) until measured. |
| **A-05** | Arch | P3 | `auth.service.ts:52–73` | `SelectableProfile`, `ProfileSelectionResponse`, `OnboardingRequiredResponse` are interfaces here but `ProfileSelectionResponseDto` exists in `dto/`. Type and DTO drift over time. | Make the service return the DTO classes directly; delete the interfaces. Or move all three interfaces to `dto/` alongside the runtime DTOs. |
| **A-06** | Arch | P3 | `registration-cleanup.service.ts` (whole file) | Co-located in `auth/` — fine. Hard-delete with `deleteMany` cascades via FK to `VerificationCode` and `RefreshToken`. The reliance on `ON DELETE CASCADE` is correct but **undocumented** at the call site — a future reader might assume soft-delete and add a `where: { is_deleted: false }` filter. | Add a one-line WHY comment confirming the cascade is intentional, and reference the schema (similar to the existing line 33–34). |
| **C-01** | Clean | P2 | `auth.service.ts:919–935` | `getMe` N+1: loops over `user.profiles` and calls `getEffectiveBranchIds` + `branch.findMany` per profile. For a cross-org consultant with 5 profiles → 10 extra queries. | Replace with a single `branch.findMany({ where: { organization_id: { in: orgIds }, ... }})` and a single `profileBranch.findMany({ where: { profile_id: { in: profileIds }}})`, then group in memory. The OWNER-shortcut in `getEffectiveBranchIds` complicates this — bake the role-set into the initial profile query and branch in-process. |
| **C-02** | Clean | P2 | `auth.service.ts:334–389` vs `1054–1104` | `resendOtp` and `resendPasswordResetCode` share near-identical cooldown + hourly-cap logic. 50+ lines of duplicate code, different only in `purpose` and identity-resolution. | Extract `VerificationCodesService.assertCanResend({ userId, purpose })` that throws on cooldown/hourly-cap violations. Both callers then become 5 lines. |
| **C-03** | Clean | P3 | `auth.service.ts:45–49` + `669` + `1141–1152` | Constants `BCRYPT_ROUNDS`, `OTP_TTL_MINUTES`, `OTP_MAX_ATTEMPTS`, `SIGNUP_RESEND_COOLDOWN_SECONDS`, `SIGNUP_RESEND_MAX_PER_HOUR` and the fallback `900` in `parseDurationToSeconds` are file-locals. They are policy, not implementation detail. | Move all to `auth.config.ts` so they are env-overridable in `.env.test` (helpful for the missing integration tests). Keep the constant names; just source from `this.authConfig`. |
| **C-04** | Clean | P3 | `auth.service.ts:149–153, 703–710, 711–719, 720–728, 736–743, 358–362, 374–378, 1073–1076, 1090–1093` | Inconsistent exception construction: some throw `new ConflictException({ message, code, details })`, others throw `new HttpException({code,message}, BAD_REQUEST)`, others throw `new HttpException('Please wait...', TOO_MANY_REQUESTS)` (bare string). All flow through `GlobalExceptionFilter` but the `details` shape varies. | Standardize on Nest's typed exceptions with the `{ message, code, details }` payload. Add a small `throwError(code, msg, statusCode, details?)` helper in `@common/exceptions`. |
| **C-05** | Clean | P3 | `auth.service.ts:597–642` | `getSelectableProfiles` (45 lines) — N+1 same as `getMe` (C-01); same fix pattern. | Apply the same batching strategy as C-01. |
| **C-06** | Clean | P3 | `auth.service.ts:1141–1152` (`parseDurationToSeconds`) | Silent fallback to `900` (15min) on unparseable input. This masks misconfiguration — e.g. `JWT_ACCESS_EXPIRATION=15min` (note the `in`) would silently produce 15-minute tokens regardless of intent. | Throw on parse failure. `parseDurationToSeconds` is called during config load; failing fast is correct. Or — better — parse once in `auth.config.ts` and store seconds. |
| **C-07** | Clean | P3 | `auth.service.ts:364`, `1079` | `60 * 60 * 1000` magic for the 1-hour window. | Extract to a constant: `RESEND_WINDOW_MS = 60 * 60 * 1000`. |
| **C-08** | Clean | P3 | `auth.controller.ts:158–160, 208–210` | `async logout` and `async resetPassword` both `await authService.X` then return `void`. The `async` is unnecessary since the controller could just return the promise — minor inconsistency with the other handlers which return the promise directly. | Pick one style. Returning the promise is slightly cheaper and aligns with the other 14 handlers. |
| **T-01** | Test | P2 | `src/core/auth/*.spec.ts` (all) | Tests are mock-heavy: every Prisma call is `jest.fn()`. Per project memory ("integration tests must hit a real database, not mocks. Reason: prior incident where mock/prod divergence masked a broken migration"), the auth module currently has **no integration tests** that exercise real schema. The S-03 finding (`BRANCH_MANAGER` does not exist as a seeded role) is a direct example of mock-mask. | Add `test/integration/auth.*.int-spec.ts` for: signup full flow (Start → Verify → Complete → Login → SelectProfile → Refresh), concurrent `signupComplete` race, refresh-token rotation across two parallel calls, reset-password full flow, and the `assertCan*` matrix against real seeded roles. |
| **T-02** | Test | P2 | (gap) | No test for refresh-token replay: presenting the same refresh token twice should fail the second time. Linked to S-02 — even the unit-test surface doesn't catch the race. | Add `it('rejects a refresh token after one successful rotation', ...)` and `it('rejects two concurrent refreshes with the same jti', ...)` (use `Promise.all`). The second test will fail today — that's the point. |
| **T-03** | Test | P2 | (gap) | No test for reset-token re-use after `resetPassword`. Linked to S-04. | Add `it('rejects a verified reset token after the password has been reset', ...)`. Will fail today. |
| **T-04** | Test | P3 | (gap) | No test for JWT type confusion: presenting a signup_token to `/auth/refresh` or a refresh_token to `/auth/me`. The strategy and decode methods all check `payload.type` but there's no asserted test. | Add table-driven tests in `jwt.strategy.spec.ts` and `auth.service.spec.ts`. |
| **T-05** | Test | P3 | `authorization.service.spec.ts:24–43` | Tests assert `assertCanViewStaff` allows `BRANCH_MANAGER` and `RECEPTIONIST`, but the Prisma mock returns whatever you give it — these tests would pass for any role string. They confirm the SQL shape (L46-67) but not the role logic. | Move these into integration tests against a real DB with the seeded role set. Combined with T-01. |

---

## Security checklist (per plan section A)

| # | Item | Pass/Fail | Notes |
|---|---|---|---|
| A.1 | Token lifecycle — JTI rotation, hashing, revocation, race | **PARTIAL** | JTI rotation present; bcrypt cost 12; soft-revoke. Race condition unaddressed → **S-02** (P1). |
| A.2 | OTP — TTL, attempts, cooldown, resend cap, hash, constant-time compare, no leakage | **PARTIAL** | 15m TTL, 5 attempts, 60s cooldown, 5/hr cap, bcrypt+timing safe via `bcrypt.compare`. **Inconsistency**: code uses cost 10, rest of module uses 12 → **S-07** (P3). |
| A.3 | Password reset — single-use, expiry, email-bound, type discriminator | **FAIL** | Type discriminator present; single-use **not enforced after `resetPassword`** → **S-04** (P2). Email enumeration → **S-01** (P1). |
| A.4 | Token type confusion — distinct `type` claim, rejected by other strategies | **PARTIAL** | Type checks present. Signup/profile_selection share `accessSecret` → **S-08** (P3). |
| A.5 | Bcrypt cost consistent across uses | **FAIL** | Mixed 10 vs 12 → **S-07** (P3). |
| A.6 | Email enumeration — `forgot-password`, `login`, `signup-start` symmetric | **FAIL** | `forgot-password` differs by response shape and timing → **S-01** (P1). `signup-start` returns 409 with `fields: ['email']` — acceptable for self-claim semantics. `login` symmetric. |
| A.7 | Logging hygiene — no secrets/OTPs/tokens in logs | **PASS (in-scope)** | Auth code doesn't log secrets. Project pino config not in scope but flagged → **S-14** (P3). |
| A.8 | JWT strategy config — no `ignoreExpiration`, Bearer extractor, secret-per-type | **PASS** | All correct. No issuer/audience claim → **S-10** (P3). |
| A.9 | Throttling on sensitive endpoints | **PARTIAL** | Most flows throttled. **`refresh` and `reset-password` unthrottled** → **S-05** (P2). All keys are IP-only → **S-06** (P2). |
| A.10 | Concurrent signup race | **PASS** | `signupComplete` uses `updateMany` + count assertion (lines 268–279). Verified by `it('returns 409 on duplicate signupComplete...')`. |
| A.11 | JTI rotation invariant — atomic revoke + issue | **FAIL** | See **S-02** (P1). |
| A.12 | Role/branch assertion ordering — no org-mismatch oracle | **PASS** | `assertCanManageStaffForTarget` queries with `organization_id` predicate (line 297); cross-org → empty result → false. No oracle. |
| A.13 | `@Public()` audit | **DEFERRED** | Only auth controller reviewed. Full codebase audit recommended → **S-13** (P3). |
| A.14 | Refresh-token storage — bcrypt, soft-revoke, cleanup | **PARTIAL** | Bcrypt 12 ✓, soft-revoke ✓, **no cleanup cron** → **S-12** (P3). |

**Plus one finding orthogonal to the checklist:**
- **A.0 / S-03** — Authorization model references roles that don't exist in the seed. This is the most impactful single finding in the review because it makes a large block of `authorization.service.ts` logically dead.

---

## Test coverage gaps

| Public method | Happy path? | Negative cases tested? | Notes |
|---|---|---|---|
| `signupStart` | ✓ | ✓ (conflict, phone collision, pending resume, reactivation) | Strong. |
| `signupVerify` | ✗ | ✗ | **Gap**: no test for the verify step (expired code, wrong code, max attempts, already verified). |
| `signupComplete` | ✓ (implicit via duplicate test) | ✓ (concurrent claim) | Doesn't test job_function/specialty resolution edge cases (unknown codes, mixed code/name match). |
| `resendOtp` | ✓ | ✓ (cooldown, hourly cap, active user, unknown email) | Strong. |
| `getRegistrationStatus` | ✓ | ✓ (NONE, bearer, status mapping) | Strong. |
| `login` | ✓ | ✓ (ONBOARDING_REQUIRED VERIFY_OTP, COMPLETE_ONBOARDING, profile selection) | Missing: invalid password, inactive user, deleted user, multiple-profile case. |
| `selectProfile` | ✓ (multi-branch, single-branch) | ✓ (BadRequest on missing branch_id, Forbidden on out-of-scope branch_id) | Strong. |
| `refresh` | ✗ | ✗ | **Big gap** — no tests at all. Covers S-02 race condition. |
| `logout` | ✗ | ✗ | Trivial but should assert revocation occurs and no-throw on invalid tokens. |
| `switchBranch` | ✗ | ✗ | **Gap** — no tests. |
| `forgotPassword` | ✗ | ✗ | **Gap** — directly relevant to S-01. |
| `resendPasswordResetCode` | ✗ | ✗ | **Gap**. |
| `verifyResetCode` | ✗ | ✗ | **Gap**. |
| `resetPassword` | ✗ | ✗ | **Gap** — directly relevant to S-04. |
| `getMe` | ✓ | ✓ (NotFound) | Doesn't test the N+1 (C-01) or multi-profile aggregation. |
| `AuthorizationService.assertCanViewStaff` | ✓ | ✓ (multiple role/jobFunction combos) | Strong, but mocked — see T-05. |
| `AuthorizationService.canManageStaffOnBranches` | ✓ | ✓ | Strong. |
| `AuthorizationService.canManageStaffForTarget` | ✓ | ✓ (cross-branch, no overlap, empty target) | Strong. |
| `AuthorizationService.assertNoPrivilegedRoleAssignment` | ✓ | ✓ | Strong. |
| `AuthorizationService.assertOwnerOnly` | ✓ | ✓ | Strong. |
| `AuthorizationService.getProfileContext` | ✗ | ✗ | **Gap** — exercised indirectly via JWT strategy in e2e tests that don't exist. |
| `AuthorizationService.canManageOrganization` / `canManageBranch` / `assertCanManageOrganization` / `assertCanManageBranch` / `assertCanManageStaff` / `assertCanAccessBranch` / `canAccessBranch` | ✗ | ✗ | **Gap** — half the authz surface is untested. Wire to integration tests against real seeded roles per T-01/T-05. |

**Aggregate:** ~70% of public methods have at least one test; ~30% of `AuthService` and ~40% of `AuthorizationService` are uncovered.

---

## Baseline (verbatim)

```
$ npx jest src/core/auth
Test Suites: 3 passed, 3 total
Tests:       51 passed, 51 total
Snapshots:   0 total
Time:        19.457 s
Ran all test suites matching src/core/auth.
```

(Suites: `auth.service.spec.ts`, `auth.controller.spec.ts`, `authorization/authorization.service.spec.ts`.)

This is the green baseline the refactor execution must preserve. Each extraction step in `auth-refactor-plan.md` runs `npx jest src/core/auth` as its gate.

---

## Verification of this review

- **Spot-checked `file:line` references** (5 random picks):
  - `auth.service.ts:511–522` → confirmed: `refresh` revoke + reissue (S-02). ✓
  - `auth.service.ts:669` → confirmed: `bcrypt.hash(code, 10)` (S-07). ✓
  - `auth.service.ts:1041–1043` → confirmed: empty-token enumeration (S-01). ✓
  - `authorization.service.ts:5–8` → confirmed: `BRANCH_MANAGER` constants (S-03). ✓
  - `auth.controller.ts:144–151` → confirmed: `refresh` has no `@Throttle` decorator (S-05). ✓
- **No source files modified** during this review — only the two artifacts under `docs/reviews/` were written.
- **Lint state unchanged** (review is read-only).
- **Baseline reproducible**: re-run `npx jest src/core/auth` from the repo root.

---

## Next step

Read the companion artifact: **`auth-refactor-plan.md`** for the ordered extraction plan that addresses A-01 (and incidentally creates the seams to fix S-02, S-04, C-02 cleanly).
