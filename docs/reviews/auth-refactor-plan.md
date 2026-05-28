# Auth Module Refactor Plan

**Companion to:** `auth-review-2026-05-28.md`
**Purpose:** Break `auth.service.ts` (1,153 LOC, 20+ public methods, 6 responsibility clusters) into focused services, in a sequence that preserves the green test baseline (51 passing) at every commit and incidentally creates the seams to fix **S-02** (refresh race), **S-04** (reset-token reuse), and **C-02** (resend duplication) cleanly.

**Out of scope for this plan:**
- The pure security fixes that don't require restructuring (**S-01** forgot-password enumeration, **S-05/S-06** throttling, **S-07** bcrypt cost, **S-10** issuer claim, **S-12** refresh-token GC, **S-14** pino redaction). These go in a separate hardening PR before or after the refactor — they're a few-line drops, not module work.
- The dead `BRANCH_MANAGER` cleanup (**S-03**) — a domain decision that belongs in its own PR.
- New event publishing (**A-03**) — done after refactor; the new services are the natural emission sites.

---

## Target file layout (after refactor)

```
src/core/auth/
├── auth.module.ts
├── auth.controller.ts            (unchanged signatures, body delegates to new services)
├── auth.service.ts               (REMOVED — facade not needed; controllers inject specific services)
├── interfaces/
│   └── jwt-payload.interface.ts  (unchanged)
├── strategies/
│   └── jwt.strategy.ts           (unchanged)
├── services/
│   ├── tokens.service.ts         (was lines 760–895, 987–1029, 1141–1152)
│   ├── verification-codes.service.ts  (was lines 334–389, 653–749, 1054–1104 cooldown logic)
│   ├── signup.service.ts         (was lines 91–332, 391–419)
│   ├── sessions.service.ts       (was lines 421–595, 597–651, 897–985)
│   └── password-reset.service.ts (was lines 1031–1139)
├── authorization/                (unchanged)
├── dto/                          (unchanged; some interfaces from auth.service.ts merged here — see A-05)
└── registration-cleanup.service.ts  (unchanged)
```

Rationale for collapsing `me` into `sessions`: `getMe` is only an authenticated read of profile state — it belongs with `selectProfile` / `switchBranch` which produce the same shape. Splitting it into its own service is over-engineering.

Rationale for deleting `auth.service.ts` rather than leaving a facade: the controller injects specific services directly; a facade adds an indirection layer with no behavioral benefit and would just re-grow over time.

---

## Per-extraction breakdown

### Step 1 — `TokensService`

**Motivation:** Smallest, lowest-risk extraction. All current methods are private helpers with no DB writes except `RefreshToken` row management. Establishes the cross-service injection pattern. Creates the seam to fix S-02 (refresh race) cleanly.

**Public surface:**
```ts
class TokensService {
  // Signup / selection tokens (currently signed with accessSecret)
  issueSignupToken(userId: string, type: 'signup' | 'profile_selection'): { signup_token: string; expires_in: number }
  decodeSignupToken(token: string, expectedType: 'signup' | 'profile_selection'): string

  // Access token (lightweight decode for the registration-status flow)
  tryDecodeAccessToken(authorization?: string): string | null

  // Password reset tokens
  issuePasswordResetToken(userId: string, target: string, verified: boolean): ResetTokenResponseDto
  decodePasswordResetToken(token: string, expectedVerified: boolean): { userId: string; target: string; jti: string }

  // The full token-pair flow — includes refresh-row creation and optional rotation
  issueTokenPair(args: {
    user: Pick<User, 'id'>
    profileId: string
    organizationId: string
    activeBranchId?: string
    revokeJti?: string   // NEW — accepts the prior jti for atomic rotation (fixes S-02)
  }): Promise<AuthTokensDto>

  // Direct revoke for logout
  revokeRefreshToken(rawRefreshToken: string): Promise<void>   // was AuthService.logout body

  // Utility
  parseDurationToSeconds(duration: string): number
}
```

**Dependencies:** `JwtService`, `ConfigService`, `PrismaService` (RefreshToken table only).

**Dependents (after step):** `AuthService` (temporarily — for the not-yet-extracted methods), `JwtStrategy` (no — it stays on `AuthorizationService.getProfileContext`).

**Key change inside `issueTokenPair`:** Wrap refresh-token revoke + new RefreshToken create in `$transaction`. When called with `revokeJti`, use guarded `updateMany({ where: { jti, is_revoked: false }, data: {...} })` and assert `count === 1` — this is the **S-02 fix**.

**Tests to add (before extraction):**
- `it('rotates refresh-token row atomically: revoke + create succeed or both fail')`
- `it('rejects a refresh-token rotation when the prior jti is already revoked')`
- `it('rejects two parallel rotations with the same prior jti — one wins')`

**Verification gate:** `npm run lint && npx jest src/core/auth` — must show 54 tests passing (51 baseline + 3 new).

---

### Step 2 — `VerificationCodesService`

**Motivation:** Already deduplicated at the helper level (`sendVerificationCode`/`consumeVerificationCode`) but the **resend cooldown + hourly cap** logic is duplicated between `resendOtp` (signup) and `resendPasswordResetCode` (reset). C-02 fix.

**Public surface:**
```ts
class VerificationCodesService {
  send(input: {
    userId: string
    target: string
    purpose: VerificationPurpose
    isResend?: boolean
  }): Promise<void>

  consume(input: {
    userId: string
    target: string
    purpose: VerificationPurpose
    code: string
  }): Promise<void>

  // Cooldown + hourly-cap guard, shared by signup-resend and reset-resend
  assertCanResend(input: { userId: string; purpose: VerificationPurpose }): Promise<void>
}
```

**Dependencies:** `PrismaService`, `EmailService`.

**Dependents:** `SignupService` and `PasswordResetService` after their extractions.

**Key change:** `assertCanResend` is the new shared rate-limit helper. `send` accepts an optional `tx` parameter (a Prisma transaction client) so callers can run send + parent mutation atomically — this is the seam for the S-11 fix (signupStart reactivation transaction).

**Constants policy:** Per C-03, hoist `OTP_TTL_MINUTES`, `OTP_MAX_ATTEMPTS`, `SIGNUP_RESEND_COOLDOWN_SECONDS`, `SIGNUP_RESEND_MAX_PER_HOUR`, and the OTP bcrypt cost into `auth.config.ts` and read via `this.authConfig.verificationCodes.*`. The constants stay in code but their values come from config — tests can override via `.env.test`.

**Tests to add:**
- Move the existing 4 resend tests in `auth.service.spec.ts` (cooldown, hourly cap, active user, unknown email) to a new `verification-codes.service.spec.ts`.
- Add: `it('consume increments attempts atomically on wrong code')`.
- Add: `it('rejects code after attempts >= max_attempts')` (sharpens the existing implicit coverage).

**Verification gate:** all baseline + new tests pass; lint clean.

---

### Step 3 — `PasswordResetService`

**Motivation:** Self-contained cluster (4 public methods), gives us the chance to fix **S-04** (reset-token re-use) with a fresh design rather than retrofitting onto the existing service.

**Public surface:**
```ts
class PasswordResetService {
  start(dto: ForgotPasswordDto): Promise<ResetTokenResponseDto>
  resend(dto: ResendResetCodeDto): Promise<ResetTokenResponseDto>
  verify(dto: VerifyResetCodeDto): Promise<ResetTokenResponseDto>
  reset(dto: ResetPasswordDto): Promise<void>
}
```

**Dependencies:** `TokensService`, `VerificationCodesService`, `PrismaService`.

**S-04 fix during this step (optional but recommended):**
Add a `PasswordResetToken` table with `jti, user_id, verified, consumed_at, expires_at`. `start` writes the row; `verify` updates `verified=true`; `reset` `findUnique` by jti, asserts `consumed_at IS NULL`, then sets `consumed_at = now()` inside the same `$transaction` as the password update.

If we don't want to add a table now, defer S-04 to a follow-up — the extraction itself doesn't depend on it.

**S-01 fix is also natural to do here:** the `start` method is the single place that decides the response shape. Synthetic-token-on-not-found goes here.

**Tests to add (filling T-03 gap):**
- `it('returns a token shape that does not distinguish unknown email')`
- `it('rejects a verified reset token after the password has been reset')`
- `it('expires the reset token after registrationExpiration')`

**Verification gate:** all auth tests pass.

---

### Step 4 — `SignupService`

**Motivation:** Largest cluster (~300 LOC), but by this point the helpers it depends on (`TokensService`, `VerificationCodesService`) are extracted, so it shrinks naturally. Also encloses the most complex single method (`signupComplete` with its `$transaction`).

**Public surface:**
```ts
class SignupService {
  start(dto: SignupStartDto): Promise<{ signup_token: string; expires_in: number }>
  verify(dto: SignupVerifyDto): Promise<{ signup_token: string; expires_in: number }>
  complete(dto: SignupCompleteDto): Promise<ProfileSelectionResponse>
  resendOtp(dto: ResendOtpDto): Promise<{ success: true }>
  getRegistrationStatus(input: { email?: string; authorization?: string }): Promise<{ step: RegistrationStep; email?: string }>
}
```

**Dependencies:** `TokensService`, `VerificationCodesService`, `PrismaService`, optionally `SessionsService.buildProfileSelectionResponse` (which is what `signupComplete` calls at its tail).

**Cross-service call:** `signupComplete` ends with `buildProfileSelectionResponse(userId)`. Two options:
- (a) Inject `SessionsService` and call `sessionsService.buildProfileSelectionResponse(userId)`.
- (b) Duplicate the helper (~10 lines) in `SignupService`.
Pick (a) — small forward dependency is fine since `SessionsService` (next step) doesn't depend on `SignupService`.

**Sub-extraction inside this step:** `signupComplete` is 125 lines; split internally into helpers:
- `resolveJobFunctions(codes: string[]): Promise<JobFunction[]>`
- `resolveSpecialties(codeOrName: string[]): Promise<Specialty[]>`
- `runOnboardingTransaction(args): Promise<{ organizationId, profileId, userId }>`

These stay private to `SignupService` — not separate classes.

**Tests to add (filling gaps):**
- `signup.verify` happy path (currently not tested at all — see "Test coverage gaps" T-row in the review).
- `signup.verify` expired code, wrong code, already verified.
- `signup.complete` with unknown `job_function_codes` → 400.
- `signup.complete` with specialties resolved by name vs code.

**Verification gate:** all auth tests pass; the `signupComplete` concurrent-claim test continues to pass.

---

### Step 5 — `SessionsService`

**Motivation:** Last cluster. Encloses login, profile selection, refresh, logout, switch-branch, and the `getMe` aggregation. Largest behavioral surface area but easiest to extract last because all its helpers (`TokensService`, `VerificationCodesService`) are now stable.

**Public surface:**
```ts
class SessionsService {
  login(dto: LoginDto): Promise<ProfileSelectionResponse | OnboardingRequiredResponse>
  selectProfile(dto: SelectProfileDto): Promise<AuthTokensDto>
  refresh(dto: RefreshDto): Promise<AuthTokensDto>
  logout(rawRefreshToken: string): Promise<void>
  switchBranch(user: AuthContext, dto: SwitchBranchDto): Promise<AuthTokensDto>
  getMe(userId: string, profileId: string): Promise<MeResponseDto>

  // Used by SignupService.complete at its tail
  buildProfileSelectionResponse(userId: string): Promise<ProfileSelectionResponse>
}
```

**Dependencies:** `TokensService`, `AuthorizationService`, `PrismaService`.

**Key change inside `refresh`:** Call `tokensService.issueTokenPair({ ..., revokeJti: stored.jti })` — this is now atomic per the S-02 fix from Step 1. Delete the local `update({ is_revoked: true })` call.

**Key change inside `getMe` and `buildProfileSelectionResponse` / `getSelectableProfiles`:** Replace the N+1 (lines 614–641, 919–935) with a single `branch.findMany` per organization batch (C-01, C-05). The OWNER-vs-non-OWNER branch resolution needs care — bake the role-set into the initial profile query and decide per-profile in memory.

**Tests to add (filling biggest test gaps):**
- `refresh` full happy path + revocation assertion + replay rejection (T-02).
- `logout` revokes the matching jti and no-ops on invalid tokens.
- `switchBranch` happy path + denied branch.
- `selectProfile` full integration with `TokensService.issueTokenPair`.
- `getMe` multi-profile assertion (verifies no N+1 — count query calls in a mock-strict mode).

**Verification gate:** all auth tests pass; `npm run lint` clean.

---

### Step 6 — Delete `auth.service.ts`

By this point the file contains only the constructor and field declaration. Delete it. Update `auth.module.ts` providers list. Update `auth.controller.ts` to inject the five new services directly.

**Verification gate:** `npm run build` clean, `npx jest src/core/auth` green, `npm run lint` clean. End-to-end smoke test of the booking flow (since auth context flows through every authenticated endpoint).

---

## Execution rules

1. **One service per commit.** Each step is one commit on `feature/auth-refactor`. No mixed extractions.
2. **Green gate between steps.** `npm run lint && npx jest src/core/auth` MUST pass before the next step starts. Baseline at start of work: 51 tests passing.
3. **No behavioral changes during extraction itself.** A step that extracts AND fixes a finding (S-02 in Step 1, S-04 in Step 3, S-01 in Step 3, C-01/C-05 in Step 5) commits the extraction first, gate, then commits the fix. Two commits per fix-bearing step.
4. **DTO shapes unchanged.** Controllers continue to accept and return the same DTOs. The refactor is internal.
5. **No new public API endpoints** in this branch.
6. **Constants migration** (C-03) happens in Step 2 since `VerificationCodesService` is the largest constant consumer.
7. **No `auth.service.ts` facade.** Controllers inject the new services directly. If a controller method needs two services (e.g. signup completing then issuing tokens), inject both — no orchestration class.

## Rollback strategy

- Each step is a single commit. `git revert <sha>` undoes one extraction cleanly.
- The final delete-`auth.service.ts` commit can be reverted independently if a downstream consumer was missed.
- If a step's new tests reveal an existing latent bug that we don't want to fix immediately, mark the test `it.skip` with a TODO referencing this review and the finding ID. Do **not** delete the test.

## Post-refactor follow-ups (separate PRs)

After the refactor lands and tests are green:

| Finding | PR | Effort |
|---|---|---|
| S-01, S-09 forgot-password enumeration | "auth: collapse forgot-password response shape" | Small |
| S-03 `BRANCH_MANAGER` cleanup | "auth: remove dead BRANCH_MANAGER role references" OR "auth: seed BRANCH_MANAGER role" | Medium (domain decision) |
| S-05, S-06 throttle tightening | "auth: per-endpoint and per-identifier throttling" | Small |
| S-07 bcrypt cost unification | rolled into Step 2's constants migration | None |
| S-08 token type confusion → `aud` claim | "auth: add `aud` claim to all JWTs" | Small |
| S-12 refresh-token GC | "auth: extend registration-cleanup to purge stale refresh tokens" | Small |
| S-13 `@Public()` audit | one-shot grep + spot-check; no code change unless a leak found | Small |
| S-14 pino redaction | "logging: redact auth secrets from request bodies" — touches `@infrastructure/logging` | Small |
| A-03 EventBus emission | "auth: emit signup/login/reset audit events" | Medium |
| A-04 strategy query reduction | "auth: combine user+profile lookup in JwtStrategy" | Medium |
| T-01 integration test suite | "test: auth integration suite against real Postgres" | Large |

## Time estimate

- Step 1 (TokensService + S-02 fix): half a day.
- Step 2 (VerificationCodesService + C-02 dedup + C-03 constants): half a day.
- Step 3 (PasswordResetService + S-01 + S-04 fix incl. new table + migration): one day.
- Step 4 (SignupService + sub-helpers + signup.verify test coverage): half a day.
- Step 5 (SessionsService + C-01/C-05 N+1 fixes + missing test coverage): one day.
- Step 6 (delete + final wiring + smoke): half a day.

**Total: ~3.5–4 dev-days for the refactor.** Hardening follow-ups can be interleaved or batched separately.
