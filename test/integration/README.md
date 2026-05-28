# Integration tests

These suites run the full Nest application against a real Postgres so
they cover the seams unit tests cannot: Prisma query semantics, the
request/response pipeline, transactional behavior, and concurrency.

## Setup

1. Provision a Postgres database **dedicated to tests** — the suite
   truncates user-scoped tables between cases. Do not point at any
   database that holds real data.

2. Create `test/.env.test` (gitignored):

   ```
   DATABASE_URL="postgresql://user:pass@host:port/dbname?sslmode=require"
   DIRECT_URL="postgresql://user:pass@host:port/dbname?sslmode=require"
   JWT_ACCESS_SECRET="test-access-secret-at-least-32-chars!!"
   JWT_REFRESH_SECRET="test-refresh-secret-at-least-32-chars!!"
   JWT_RESET_SECRET="test-reset-secret-at-least-32-chars!!"
   RESEND_API_KEY="test-key"
   RESEND_FROM_EMAIL="noreply@example.com"
   ```

3. Run:

   ```
   npm run test:integration
   ```

   `helpers/global-setup.ts` runs `prisma migrate deploy` + `prisma db
   seed` once before the suite, so the schema and lookup data
   (`OWNER`/`BRANCH_MANAGER`/`STAFF`/`EXTERNAL` roles, job functions,
   `free_trial` subscription, `OBGYN` specialty, journey templates) are
   in place. `helpers/db-cleaner.cleanDatabase` truncates user-scoped
   tables (`users`, `organizations`, `refresh_tokens`,
   `password_reset_tokens`, `auth_audit_log`, etc.) between cases.

## Suites

| File | Closes |
|---|---|
| `auth/signup-full-flow.int-spec.ts` | Canonical happy-path: signup → verify → complete → login → select → refresh → me. |
| `auth/refresh-race.int-spec.ts` | S-02 — parallel refreshes for the same token; the loser 401s, only one new row is created, and a rotated token cannot be replayed. |
| `auth/password-reset-reuse.int-spec.ts` | S-04 — the verified reset token is single-use; a re-use attempt 401s and the password is unchanged. Also pins S-01: forgot-password on an unknown email returns the same shape and writes no rows. |

## Notes for future work

- `test/auth/onboarding.e2e-spec.ts` predates the auth-refactor and is
  stale (uses the removed `roles` field on `/v1/auth/signup/complete`
  and asserts profile fields like `is_clinical` / `specialty` /
  `job_title` that moved to `JobFunction` and `ProfileSpecialty`).
  Bring that file current as a separate cleanup.
- The review report's T-01 also calls for `signup-race.int-spec.ts`
  (parallel `signup/complete` for the same token) and an
  `authorization-matrix.int-spec.ts` exercising `assertCan*` against
  real seeded roles. Add when the value vs. CI-time trade-off makes
  sense.
