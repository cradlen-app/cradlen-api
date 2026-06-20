# Security Assessment — Cradlen API

**Engagement:** adversarial ("real hacker") review of the multi-tenant healthcare
backend, run as a hybrid white-box + live exercise. Candidates were found by code
tracing and then **proven** against a running app on the dedicated test database via
the integration harness — so every claim below is backed by a passing/failing test, not
a guess.
**Date:** 2026-06-20 · **Branch:** `feature/specialty-subspecialty`

---

## TL;DR

The tenancy and authorization core is **strong**. The two loudest candidate
"criticals" (cross-tenant IDOR via `:organizationId`, permissive CORS) are **false
positives** — proven by 41 passing isolation tests and by reading the actual CORS
semantics. The genuinely actionable items were smaller: a **migration-integrity bug**
that breaks signup on any fresh deploy, and **missing upper bounds on money inputs**.
Both are now fixed with regression tests.

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| F1 | Committed migrations can't rebuild the DB → signup 500 on fresh deploy/DR | **High (availability/integrity)** | ✅ Fixed + verified |
| F2 | No upper bound on monetary inputs (`unit_price`, payment `amount`) | **Medium** | ✅ Fixed + tested |
| F3 | `GET /auth/registration/status?email=` unthrottled account enumeration | Low | ✅ Fixed (IP throttle) |
| F4 | P2002 errors return unique-constraint field names | Low | ✅ Fixed (allowlist) |
| F5 | Presigned GET TTL 300s + client-asserted content-type | Low | ✅ Fixed (TTL 120s) |
| F6 | `CORS_ORIGINS` empty in prod silently rejects all browser clients | Low (availability) | ✅ Fixed (boot fail-fast) |
| F7 | `GET /patients/search` cross-tenant PII enumeration (fuzzy + full PII) | **High** | ✅ Fixed (exact-match + minimal projection) |
| — | Cross-tenant IDOR / CORS reflect-any / upload overwrite / SQLi | — | ❌ Disproven (see below) |

---

## What I tried to break and could NOT (defenses that hold)

These are the attacks a real intruder would reach for first. Each was attempted; each is
already defended. Most are pinned by the existing integration suite (**9 suites / 41
tests, all green** this run).

- **Cross-tenant data theft (IDOR).** An OWNER of Org A hitting Org B's
  `:organizationId`/`:branchId` routes (branches, invitations, financial, clinical) gets
  **403/404**. The defense is structural: a JWT's `profileId` is bound to one `(user, org)`
  pair, and every `AuthorizationService` check joins `Profile → organization_id`, so a
  swapped path id resolves to a profile that doesn't exist in the target org and fails
  closed. *Pinned by `auth/cross-tenant-authz.int.spec.ts`, financial `*-security` specs.*
- **CORS reflect-any.** `cors: { origin: [] }` is **fail-closed** in the `cors` package
  (no origin allowed), not reflect-any. No CSRF surface. (The empty default is an
  availability footgun in prod — see F-note below — not a security hole.)
- **Token forgery / confusion.** Wrong-secret, `alg:none`, expired, refresh-as-access,
  `password_reset`-as-access, and staff-token-on-patient-route are all rejected with 401.
  *Pinned by `auth/token-security.int.spec.ts` (9/9).*
- **Privilege escalation.** STAFF cannot invite; a BRANCH_MANAGER cannot grant
  OWNER/BRANCH_MANAGER. *Pinned by `auth/privilege-escalation.int.spec.ts`.*
- **Patient-portal IDOR + upload abuse.** A portal session is scoped to
  `accessiblePatientIds`; passing another patient's `patient_id`/investigation id is
  rejected with 404. Presigned PUT keys are **server-derived UUIDs** (non-guessable),
  `confirmResult` re-validates the key prefix and re-reads the object's content-type/size
  from R2, and only `source=PATIENT` attachments are removable.
  *Now pinned by `patient-portal/patient-portal-idor.int.spec.ts` (4/4) — this surface
  previously had no integration coverage; the new spec mints a real `patient_access` token
  and proves patient A cannot read/write patient B's visits or investigations.*
- **SQL injection.** Every raw query is a parameterized `Prisma.sql` / tagged template or
  an input-free `SELECT 1`. No `*Unsafe` call interpolates user input.
- **Auth brute force.** login (per-identifier guard + 10/10min), signup, OTP, and
  password-reset endpoints all carry explicit `@Throttle` overrides.

---

## Confirmed findings (fixed)

### F1 — Migrations can't rebuild the database → signup 500 on fresh deploy *(High)*

**Evidence.** On a database built only from `prisma/migrations` (i.e. a fresh prod deploy
or DR restore), `POST /v1/auth/signup/complete` returns **500** with Prisma `P2022:
column does not exist` at `signup.service.ts:418`.

**Root cause.** `professional_title` exists in `schema.prisma` on **Profile** and
**Invitation** (added in the specialty/subspecialty refactor) but **no committed migration
creates it** — `prisma migrate diff` against a freshly-migrated DB reported exactly:
```
ALTER TABLE "profiles"    ADD COLUMN "professional_title" TEXT;
ALTER TABLE "invitations" ADD COLUMN "professional_title" TEXT;
```
Dev/prod were patched out-of-band, masking the gap; any new environment breaks.

**Fix.** Added the missing migration
`prisma/migrations/20260620120000_add_professional_title/migration.sql` (idempotent
`ADD COLUMN IF NOT EXISTS`, safe to re-apply over already-patched DBs). After applying,
`migrate diff` reports an empty diff and the previously-failing signup tests pass.

**Verification.** `token-security.int.spec.ts` went from 3 failing → **9/9 passing**.

### F2 — No upper bound on monetary inputs *(Medium)*

**Evidence.** `CaptureChargeDto.unit_price`, `RecordPaymentDto.amount`, and
`CreateInvoiceDto` item `unit_price` validated `@Min` only — **no `@Max`**. Monetary
columns are `Decimal(10,2)` (hard ceiling 99,999,999.99), so:
- a `unit_price` like `10,000,000` is **silently accepted** and frozen onto the charge
  (absurd-charge / revenue-corruption vector for any authorized capturer), and
- a value `≥ 1e8` **overflows the column → unhandled 500** instead of a clean 400.

**Fix.** Added `MAX_MONETARY_AMOUNT = 9_999_999.99` to the financial `Money` module and
`@Max(MAX_MONETARY_AMOUNT)` to the three money DTOs. Oversized input is now a clean **400**
at the validation boundary; ordinary amounts and the exact ceiling still pass.

**Verification.** New `test/integration/financial/money-bounds.int.spec.ts` — **5/5
passing** (over-ceiling charge → 400, ceiling → 201, ceiling+0.01 → 400, over-ceiling
payment → 400, over-ceiling invoice item → 400). Pre-fix, `10,000,000` fits `Decimal(10,2)`
and was accepted (201); the `@Max` is the sole reason it now 400s.

### F7 — `GET /patients/search` cross-tenant PII enumeration *(High)*
**Evidence.** The global patient lookup (book-visit autocomplete) is authenticated but
takes no org context and ran a `contains` (fuzzy) match on `full_name` / `national_id` /
`phone_number` across **all** patients in **all** organizations, returning full PII
(national id, DOB, address, phone). With the DTO's 2-char minimum, any authenticated user
of any org could enumerate the entire multi-tenant patient population and harvest PII —
e.g. `?search=a`. (Flagged by the background security review; confirmed exploitable.)

**Root cause.** The endpoint is *intentionally* cross-org (find a patient first registered
at another clinic), but it conflated "confirm a known identity" with "search everything"
and over-projected.

**Fix.** Restrict to an **exact** `national_id` or `phone_number` match (no fuzzy, no name
key — org-scoped fuzzy search already lives in `GET /patients`/`findAll`), reduce the
projection to `{ id, full_name }` (no PII before an org enrollment exists), and raise the
query minimum to 6 chars. Pinned by `patient/patient-global-search-security.int.spec.ts`
(5/5): exact id/phone resolve minimally; partial id, name query, and short query do not.

*Caller-contract note:* the book-visit autocomplete must now query by a full national
id/phone and receives only `{ id, full_name }` (then enroll to see detail) — a deliberate
change from partial-name autocomplete.

---

## Additional hardenings (fixed)

### F3 — `GET /auth/registration/status?email=` enumeration *(Low)*
`@Public()` with no throttle (inherited the global 100/min) and a response that differs
for known vs unknown emails — an account-enumeration sweep. **Fixed** by tightening to an
IP bucket of **20/min** (`@Throttle({ default: { limit: 20, ttl: 60000 } })`). Per-identifier
throttling is deliberately *not* used here: each probe is a different email, so only the IP
bucket bounds the sweep.

### F6 — CORS empty-in-prod footgun *(Low / availability)*
`CORS_ORIGINS` defaulting to `[]` is fail-closed, so an unset prod env silently rejects all
first-party browser clients. **Fixed** by a boot-time check in `main.ts` that throws if
`CORS_ORIGINS` is empty under `NODE_ENV=production` — surfacing the misconfiguration at
startup instead of in live traffic.

### F4 — P2002 unique-conflict field names *(Low)*
`GlobalExceptionFilter` returned `details.fields = meta.target` — every column of the
violated unique index, including internal FKs (`organization_id`, …) — usable to map the
schema's constraints. **Fixed** by allowlisting caller-submitted fields
(`email`, `phone_number`, `national_id`, `code`, `slug`, `username`): the signup UX still
learns which of *its* inputs conflicted, but internal columns are withheld. Pinned by a new
case in `global-exception.filter.spec.ts` (`target: [organization_id, code, email]` →
`fields: [code, email]`). The existing signup-edge-cases assertions (email/phone_number)
still pass.

### F5 — Presigned GET TTL *(Low)*
Result-download URLs lived **300s**. **Fixed** by lowering the default
`R2_PRESIGN_GET_TTL_SECONDS` to **120s** — a presigned GET only needs to live long enough
to *start* the fetch, so this narrows the replay window for a leaked URL (PUT TTL stays 300s
for larger/slower uploads; both remain env-overridable). *Residual (accepted):* the stored
content-type is the client-declared one on PUT (no magic-byte inspection) — standard for
presigned flows and low risk given keys are non-guessable and access is list-gated.

---

## How to reproduce / verify

```bash
# 1) Migration integrity is restored (was the F1 blocker)
ENV_FILE=test/.env.test npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --script   # → empty migration

# 2) Existing isolation/authz defenses still hold (the disproven "criticals")
npx jest --config test/jest-integration.json test/integration/auth test/integration/financial
#   → 9 suites / 41 baseline tests green

# 3) The new money-bounds regression suite
npx jest --config test/jest-integration.json test/integration/financial/money-bounds.int.spec.ts
#   → 5/5 green

# 4) Compile
npm run build   # → webpack compiled successfully
```

## Changed files
- `prisma/migrations/20260620120000_add_professional_title/migration.sql` *(new — F1)*
- `src/core/financial/shared/money/money.ts` *(F2 — `MAX_MONETARY_AMOUNT`)*
- `src/core/financial/charging/dto/capture-charge.dto.ts` *(F2)*
- `src/core/financial/payments/dto/record-payment.dto.ts` *(F2)*
- `src/core/financial/invoicing/dto/create-invoice.dto.ts` *(F2)*
- `test/integration/financial/money-bounds.int.spec.ts` *(new — F2 regression)*
- `src/core/auth/auth.controller.ts` *(F3 — IP throttle on registration/status)*
- `src/main.ts` *(F6 — CORS prod fail-fast)*
- `src/common/filters/global-exception.filter.ts` + `.spec.ts` *(F4 — conflict-field allowlist + test)*
- `src/config/storage.config.ts`, `.env.example`, `CLAUDE.md` *(F5 — GET TTL 120s + docs)*
