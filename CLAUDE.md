# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev        # Hot-reload dev server (webpack-based)
npm run start:debug      # Debug mode with hot-reload

# Build
npm run build            # prisma generate && nest build (webpack bundles to dist/main.js)

# Testing
npm run test             # Unit tests (Jest, reads jest config from package.json)
npm run test:watch
npm run test:cov
npm run test:e2e         # ./test/jest-e2e.json
npm run test:integration # ./test/jest-integration.json

# Single test file (note: tests now live under src/core/, not src/modules/)
npx jest src/core/health/health.service.spec.ts
npx jest -t 'descriptive test name fragment'

# Code quality
npm run lint             # ESLint with --fix
npm run format           # Prettier

# Database (Prisma)
npx prisma migrate dev --name <migration-name>
npx prisma migrate dev --create-only --name <name>   # generate SQL without applying
npx prisma generate
npx prisma migrate status
npx prisma db seed                                   # canonical lookup data (roles, job functions, plans, specialties, procedures)
npm run seed:fixtures                                # 3 demo orgs (jasmin, janah, amshag) with cross-org doctors. NEVER run in production.
```

## Architecture

**Stack:** NestJS (v11) + Prisma (v7) + Neon (serverless PostgreSQL). Build via webpack (`nest-cli.json` → `webpack.config.js`).

### Layered structure

```
src/
├── main.ts                   # First import is '@infrastructure/monitoring/sentry' (must stay first)
├── app.module.ts             # Wires Sentry + MessagingModule + ConfigModule + Throttler + every core module; registers JwtAuthGuard + ThrottlerGuard globally
├── common/                   # Foundation: decorators, filters, guards, interceptors, pipes, swagger helpers, paginated() utility
├── config/                   # @nestjs/config factories — env var schemas (app, auth, database)
├── infrastructure/           # Adapters wrapping vendor SDKs
│   ├── database/             # PrismaService (.db getter), DatabaseModule (@Global)
│   ├── messaging/            # EventBus facade over EventEmitter2; realtime/ Socket.IO gateways
│   ├── email/                # Resend wrapper (EmailService, EmailModule @Global)
│   ├── logging/              # Pino logger
│   ├── monitoring/           # Sentry init (sentry.ts; preloaded via main.ts first import)
│   └── cache, queue, sms, storage/   # Stub READMEs — no consumer yet
├── core/                     # Domain layer
│   ├── auth/                 # auth (3-step signup, login, OTP, password reset) + authorization/ (role/branch checks)
│   ├── org/                  # organizations, branches, profiles, staff, invitations, roles, job-functions, specialties, subscriptions
│   ├── patient/patients/     # Patient records (cross-org via PatientJourney)
│   ├── clinical/             # clinical/ (encounter/vitals/prescriptions/investigations), visits/ (+ encounter-mutation guard), care-paths/, journeys/, journey-templates/, patient-history/, lab-tests/, medications/, medical-rep/, events/ (domain-events catalog)
│   ├── notifications/        # In-app notifications + listener that maps invitation events → notifications
│   └── health/               # DB connectivity probe
├── builder/                  # Form-builder DSL — fields, sections, rules, runtime, renderer, validator, templates (workflows/ still empty)
├── specialties/              # Vertical specialty modules — sibling layer to plugins. Currently obgyn/ (visit-encounter, patient-history, pregnancy, amendments)
└── plugins/                  # Scaffold only — extension layer for future verticals (telemedicine, billing, …)
```

### Dependency rules (enforced by ESLint `import/no-restricted-paths`)

```
common              → nothing (foundation)
infrastructure      → common
builder             → common, infrastructure
core                → common, infrastructure, builder
plugins/specialties → common, infrastructure, builder, core (convention: import core only via *.module.ts | *.public.ts)
```

`plugins` and `specialties` are **sibling layers** and must not import from each other. Core, infrastructure, and builder must not import from either.

The current exception: `common → @infrastructure/logging` is allowed because `LoggingInterceptor` (in `common/interceptor/`) needs the Pino logger. Tighten when the interceptor moves out of common. Do not introduce new exceptions casually — each one weakens the kernel boundary.

**Note:** The `plugins/specialties → core only via *.module.ts | *.public.ts` rule is preserved as a convention but is **not currently ESLint-enforced** — the `except`-glob matching in `eslint-plugin-import` is unreliable on Windows backslash paths. Treat it as a code-review rule.

### TS path aliases

Configured in `tsconfig.json`, `package.json` jest `moduleNameMapper`, `test/jest-{e2e,integration}.json`, and `webpack.config.js` (native `resolve.alias` + `extensionAlias { '.js': ['.ts','.js'] }`):

```
@common/*  @config/*  @infrastructure/*  @builder/*  @core/*  @plugins/*  @specialties/*
```

Source uses NodeNext-style `.js` suffixes on TS imports; webpack/jest both handle the rewrite. **Always prefer aliases for cross-layer imports.** Same-folder and same-feature imports stay relative.

### Cross-module communication

Modules under `core/` are loosely coupled — nearly zero direct service-to-service imports across siblings. The pattern:

1. **Domain events** via `EventBus.publish(event, payload)` from `@infrastructure/messaging/event-bus`. Subscribers use `@OnEvent('event.name')` from `@nestjs/event-emitter`.
2. **Realtime fan-out** is handled in `@infrastructure/messaging/realtime/` — gateways subscribe to events and emit to socket rooms. Services do **not** know about Socket.IO. (Example: `visits.service` publishes `visit.booked`; `VisitsGateway` listens and broadcasts.)
3. **Notifications** are produced the same way: `invitations.service` publishes `invitation.accepted` / `invitation.declined`; `notifications.listener` writes a Notification row.

When adding a new cross-module concern, prefer this pattern over direct service injection.

### Multi-org domain model

The system is multi-tenant by **Organization**. The same physical person (`User`) can belong to multiple organizations via separate `Profile` rows — one per (user, organization) pair.

- `User` = identity (email, password, phone). One per real person.
- `Profile` = membership in one organization. Everything operational (roles, branches, schedule, calendar events, visits) hangs off the Profile, never the User.
- Cross-org consultants get one Profile per clinic with `engagement_type=ON_DEMAND` and the `EXTERNAL` role.

### Roles vs. job functions vs. executive titles

Three independent axes; don't conflate:

- **Role** (`Role` table) — authority tier. Seeded: `OWNER` (manages org), `STAFF` (works inside org), `EXTERNAL` (cross-org consultant). Drives `AuthorizationService` checks.
- **JobFunction** (`JobFunction` table) — what the person does. Seeded clinical: `OBGYN`, `ANESTHESIOLOGIST`, `PEDIATRICIAN`, `OTHER_DOCTOR`, `NURSE`, `ASSISTANT`. Operational: `RECEPTIONIST`, `ACCOUNTANT`. Add new functions as seeds, not as Roles. Drives staff filtering and function-aware service-layer checks (e.g. financial endpoints check for `ACCOUNTANT`).
- **executive_title** (enum on Profile) — `CEO | COO | CFO | CMO`. Display/governance only — does NOT grant permissions.
- **engagement_type** (enum on Profile, default `FULL_TIME`) — `FULL_TIME | PART_TIME | ON_DEMAND | EXTERNAL_CONSULTANT`.

There is intentionally no Permission table. For finer-grained checks, prefer a JobFunction predicate in the service layer over inventing new roles.

### Key conventions

**Response shape:** `ResponseInterceptor` wraps every response → `{ data: T, meta: {} }`. Two exceptions: returning `undefined` passes through unwrapped (use for 204 No Content); returning an object that already has a `data` or `message` key bypasses wrapping. For paginated responses return `paginated(items, { page, limit, total })` from `@common/utils/pagination.utils` — the interceptor detects a non-enumerable `__paginatedPayload` marker and restructures to `{ data: items[], meta: { page, limit, total, totalPages } }`. Always use `paginated()`; never construct the payload manually.

**Error shape:** `GlobalExceptionFilter` returns `{ error: { code, message, statusCode, details, requestId } }`. Prisma error mappings: P2002 → 409, P2025 → 404, P2003 → 400. The `details` structure varies:
- Validation errors: `{ fields: { [fieldName]: string[] } }`
- P2002 unique conflict: `{ fields: string[] }`
- P2003 foreign-key violation: `{ field: string }`
- All other errors: `{}`

**Database access:** Inject `PrismaService` from `@infrastructure/database/prisma.service` and use `this.prismaService.db.<model>.<method>()`. `DatabaseModule` is `@Global()`.

**Soft deletes:** Models use `is_deleted Boolean @default(false)` + `deleted_at DateTime?`. Always filter `where: { is_deleted: false }` unless intentionally fetching deleted records.

**Swagger decorators** (`@common/swagger`): `@ApiStandardResponse(DtoClass)`, `@ApiPaginatedResponse(DtoClass)`, `@ApiVoidResponse()`.

**Authentication:** `JwtAuthGuard` is registered globally — every route requires a valid Bearer token by default. Use `@Public()` to opt out.

**`@CurrentUser()`** injects an `AuthContext`:
```ts
interface AuthContext {
  userId: string;
  profileId: string;
  organizationId: string;
  activeBranchId?: string;
  roles: string[];        // e.g. ['OWNER']
  branchIds: string[];    // branches the profile is assigned to
}
```
The JWT strategy rejects tokens with `type !== 'access'` and calls `AuthorizationService.getProfileContext()` to populate this per request.

**Authorization** (`@core/auth/authorization/authorization.service`):
- `assertCanManageOrganization` / `canManageOrganization`
- `assertCanManageBranch` / `canManageBranch` / `assertCanAccessBranch` / `canAccessBranch`
- `assertCanManageStaff` / `canManageStaff` / `assertCanViewStaff` / `canViewStaff`
- `assertCanManageStaffOnBranches` / `canManageStaffOnBranches`
- `assertCanManageStaffForTarget` / `canManageStaffForTarget`
- `assertOwnerOnly`, `assertNoPrivilegedRoleAssignment`

### Auth flows

**Signup (3 steps):**
1. `POST /auth/signup/start` → creates `User`, sends OTP, returns `signup_token`.
2. `POST /auth/signup/verify` → validates OTP, marks `verified_at`, returns fresh `signup_token`.
3. `POST /auth/signup/complete` → creates `Organization` (+ main `Branch`), `Profile` with `OWNER` role and the requested `job_function_codes` / `executive_title` / `engagement_type` / specialties, plus a free-trial `Subscription`. Returns a `ProfileSelectionResponse`.

The signup-complete payload accepts: `organization_name`, `specialties: string[]` (codes or names — resolved against the `Specialty` table), `branch_*` fields, `job_function_codes?: string[]` (must exist in `JobFunction`), `executive_title?`, `engagement_type?`. The founder is always `OWNER` — there is no `roles` field.

**Login / profile selection:**
- `POST /auth/login` (email+password) or `POST /auth/phone/request-otp` → `POST /auth/phone/verify-otp`
- Both return either:
  - `{ type: 'profile_selection', selection_token, profiles[] }` — user has multiple profiles
  - `{ type: 'ONBOARDING_REQUIRED', step: 'VERIFY_OTP' | 'COMPLETE_ONBOARDING' }`
- `POST /auth/profiles/select` exchanges `selection_token + profile_id` → `{ type: 'tokens', access_token, refresh_token, ... }`

JWT tokens carry `{ userId, profileId, organizationId, type }`. Refresh tokens use JTI rotation (each refresh revokes the old token; bcrypt-hashed `token_hash` stored).

**OTP:** 15-minute TTL, max 5 attempts. Resend cooldown 60s, max 5 resends/hour. `RegistrationCleanupService` purges PENDING users older than 24h hourly.

**Password reset:** `POST /auth/forgot-password` → `POST /auth/verify-reset-code` → `POST /auth/reset-password`.

### Invitations

- `POST /organizations/:orgId/invitations` — single invite. DTO accepts `email`, `first_name`, `last_name`, `phone_number?`, `role_ids[]`, `branch_ids[]`, `job_function_codes?[]`, `specialty_codes?[]`, `executive_title?`, `engagement_type?`. Validates that codes exist in their respective tables.
- `POST /organizations/:orgId/invitations/bulk` — array of up to 100. Single transaction for DB inserts (rolls back on any error); emails sent after commit; per-email failures returned in the response (`{ id, email, email_sent }`).
- `POST /invitations/accept` — public endpoint. **Detects existing user by email**: if found, validates the supplied password against the existing account's password (security gate); creates a new `Profile` against the existing `User` rather than re-registering. This is what enables cross-org consultants (e.g. janah OWNER → amshag STAFF).

### Clinical write-path: immutability, amendments, revisions

Closed-visit clinical data is treated as a legal record. Three complementary mechanisms enforce that:

**1. Encounter-mutation guard.** Section-level `PATCH` endpoints on a visit's clinical surface are blocked once `visit.status` is `COMPLETED` or `CANCELLED`.

- `EncounterMutationGuard` (`@core/clinical/visits/encounter-mutation.guard.ts`) — class-level `@UseGuards`.
- `@LocksOnClosedVisit('paramName')` decorator (`@common/decorators/locks-on-closed-visit.decorator.ts`) — opt each PATCH in. Default param is `id`; the pregnancy controller uses `visitId`. GETs pass through.
- Blocked requests return `409 ENCOUNTER_LOCKED` with the amendment endpoint hinted in `error.details`.
- `VisitsModule` exports the guard; specialty modules import `VisitsModule` to resolve it.

**2. Amendments.** `POST /v1/visits/:visitId/amendments` is the only legal write path after close.

- Authority: the visit's `assigned_doctor_id` OR an `OWNER` of the org.
- Requires `reason` (min 8 chars) and an `If-Match` version precondition.
- Targets: `obgyn_encounter`, `pregnancy_record` (visit-scoped). Patient-level (`patient_obgyn_history`) and journey/episode targets are validated but not yet routed.
- Response includes `{ target, section, version_from, version_to, amended_by_id, reason, amended_at }` for audit.

**3. Revisions (audit shadow tables).** Every PATCH and amendment writes the prior row to a paired `*_revisions` table inside the same Prisma transaction as the live-row update.

- Tables (additive, all `…_revisions`): `patient_obgyn_history`, `visit_obgyn_encounter`, `pregnancy_journey_record`, `pregnancy_episode_record`, `visit_pregnancy_record`.
- Shape: `(id, entity_id FK, version, snapshot Json, changed_fields Json, revised_by_id FK profile, revised_at, revision_reason?)`. `version` is the SNAPSHOT version — the live-row version BEFORE the change. Append-only.
- Helper: `buildRevision(prior, changedFields, revisedById, reason?)` in `@specialties/obgyn/revisions.helper`. Callers own the Prisma transaction so live-row + revision are atomic. PATCH leaves `revision_reason` null; amendments pass `dto.reason`.

**4. Bulk section PATCH per tab.** OB/GYN section PATCHes are collapsed into one bulk PATCH per tab (one transaction → one revision row covering all changed fields). When adding new specialty surfaces, follow that pattern rather than one-section-per-endpoint.

**5. Clinical domain-events catalog.** Event names for downstream consumers (notifications, AI assistants, analytics, referrals) live in `@core/clinical/events/clinical-events.ts` and are re-exported via `events.public.ts`. Publish through `EventBus`; do not invent ad-hoc event strings.

### Form-builder DSL (`src/builder/`)

DB-stored form templates the frontend renders against. Authored in code (`prisma/seeds/`), never via admin endpoints — templates are code-managed (the only sanctioned write path is `prisma db seed`).

**Subfolder roles:**

- `fields/` — `FIELD_TYPES` registry (per-field-type config invariants), `ENTITIES` registry (the extension point for `ENTITY_SEARCH` — one entry per searchable kind, not a new `FormFieldType`), `ALLOWED_PATHS` map enforcing binding integrity at seed time (typos throw before any DB write), namespaced `ConfigShape` validator (`{ui, validation, logic}` only — no flat keys).
- `rules/` — `Predicate { effect, when, message? }` types + pure `evaluate()` function. Operators: `eq` / `ne` / `in` / `and` / `or`. Effects: `visible` and `enabled` are UI-only; `required` and `forbidden` are server + UI. The server **never** consumes `visible` — a hidden-in-UI field can still be 400-rejected if its `required` predicate is true.
- `runtime/` — `TemplateExecutionContext` indexes an in-flight payload by field code for predicate evaluation.
- `renderer/` — strips internal columns (`is_deleted`, `created_by_id`, …) and attaches the typed `TemplateBindingContract` per field.
- `validator/` — `TemplateValidator.validatePayload(code, payload)` walks fields and enforces `required` + `forbidden` predicates. **Not yet wired into the book endpoints** — services have hand-coded validation for the specific exclusivity cases. Generic template-driven enforcement is deferred until template #2 lands.
- `templates/` — read-only API: `GET /v1/form-templates` (active rows), `GET /v1/form-templates/:code` (the active version), `GET /v1/form-templates/:code/versions/:version` (specific version, for stale-cache reads during rollback). The full binding contract + search-field two-bucket lifecycle + discriminator state-reset rule live in `src/builder/templates/templates.README.md`.

**Binding namespaces** (`BindingNamespace`): `PATIENT`, `VISIT`, `INTAKE`, `GUARDIAN`, `MEDICAL_REP`, `LOOKUP` (data-bound search/picker widgets — value submitted is the resolved ID), `SYSTEM` (pure flow-control, never persisted, e.g. the `visitor_type` discriminator), `COMPUTED` (server recomputes — e.g. BMI from weight/height; client value advisory).

**Active-version pointer.** `FormTemplate.is_active` + `activated_at` plus a partial unique index `(code) WHERE is_active=true AND is_deleted=false` (raw SQL in the migration — Prisma `@@unique` doesn't support `WHERE`). Read path is `WHERE is_active=true`, NEVER `max(version)`. Rollback is a pointer flip in a `$transaction([deactivate-others, activate-this])`.

**Seed governance.** Templates are upserted by `(code, version)`; the activation transaction at the end of each seed function deactivates prior versions and marks the new one PUBLISHED. The `ALLOWED_PATHS` map is cross-checked against the actual DTO classes (`BookVisitDto`, `BookMedicalRepVisitDto`, `UpsertVitalsDto`, `ChiefComplaintMetaDto`) by `src/builder/fields/allowed-paths.contract.spec.ts` via class-validator metadata introspection — a DTO rename without an `ALLOWED_PATHS` update fails CI at the moment of the rename. **DTOs for template-driven flows must stay thin** (type/shape only, no `@ValidateIf`). When a new template lands, all conditional logic goes into `config.logic.predicates`, not into class-validator decorators.

### Versioning, logging, locale

- **Versioning:** URI-based (`/v1/...`). Default version from `API_DEFAULT_VERSION`.
- **Logging:** Pino — pretty in dev, JSON in prod. Request ID propagated via `x-request-id` header. Logs are tee'd into Sentry's logging stream.
- **Locale:** `Accept-Language` parsed per request; allowed locales from `SUPPORTED_LOCALES`.

**ESLint rules enforced as errors:** `no-explicit-any`, `no-floating-promises`, `no-unsafe-argument`, `no-unused-vars` (allow `_` prefix), `no-misused-promises`, plus the layer-boundary `import/no-restricted-paths` zones above. Run `npm run lint` before committing.

### Adding a new feature

1. Decide its layer:
   - Domain feature with its own endpoints → `src/core/<bucket>/<feature>/` (pick the right bucket: `auth | org | patient | clinical | notifications | health`).
   - Vendor SDK wrapper → `src/infrastructure/<feature>/`.
   - Vertical specialty (OB/GYN, pediatrics, dermatology, …) → `src/specialties/<specialty>/`. Imports `core/<x>/*.module.ts` to resolve guards/services; never imports another specialty.
   - Cross-cutting extension (telemedicine, billing, lab integration) → `src/plugins/<feature>/`.
   - DB-backed form template / dynamic validation rule → live in `src/builder/` (DSL primitives) + `prisma/seeds/` (the seed module that authors the template).
2. Create `<feature>.module.ts`, controller, service. Inject `PrismaService` from `@infrastructure/database/...`.
3. Register the module in `app.module.ts`.
4. Use `@CurrentUser() user: AuthContext` and call `AuthorizationService` for role/branch checks.
5. Use `paginated(...)` for list endpoints and the `@ApiStandardResponse` / `@ApiPaginatedResponse` / `@ApiVoidResponse` swagger decorators.
6. For cross-module side-effects, prefer publishing via `EventBus` over injecting another module's service.
7. Add Prisma models to `prisma/schema.prisma` and run `npx prisma migrate dev --name <name>`.

### Data model (`prisma/schema.prisma`)

Core entities:

- **Organization** → many **Branch**, **Profile**, **Subscription**, **Invitation**, **PatientJourney**, **OrganizationSpecialty**
- **Branch** — unique `(id, organization_id)` so M2M tables can FK against the composite key
- **User** → many **Profile**, **RefreshToken**, **VerificationCode**
- **Role** — seeded: `OWNER`, `STAFF`, `EXTERNAL`
- **JobFunction** — seeded clinical/operational set; `is_clinical` is a column on `JobFunction` (not on `Profile`)
- **Profile** — `(user_id, organization_id)` unique. Carries `executive_title?` and `engagement_type` (default `FULL_TIME`). Job functions and specialties live in M2M tables (`ProfileJobFunction`, `ProfileSpecialty`). Branches via `ProfileBranch`.
- **Invitation** — pre-assigns roles, branches, job functions, specialties, executive_title, engagement_type. Accept flow copies these onto the new Profile.
- **Specialty** — catalog (`code` unique). Linked to `Procedure`, `JourneyTemplate`, and to `Profile`/`Organization`/`Invitation` via M2M.
- **Procedure** — surgery catalog (e.g. `CESAREAN_SECTION`).
- **WorkingSchedule** → **WorkingDay** → **WorkingShift** — per (profile, branch).
- **Patient** → many **PatientJourney** → many **PatientEpisode** → many **Visit**. `Patient.marital_status` (enum) gates spouse capture.
- **Guardian** + **PatientGuardian** — guardian (national_id-keyed) linked to patient with `relation_to_patient: GuardianRelation` (SPOUSE / PARENT / CHILD / …). Spouses are upserted at booking time when `marital_status=MARRIED`.
- **Visit.appointment_type** is `VISIT | FOLLOW_UP`. `MEDICAL_REP` visits live in a separate table — see below.
- **MedicalRep** + **MedicalRepVisit** + **MedicalRepMedication** + **MedicalRepVisitMedication** — org-scoped pharma rep visits. Booked via `POST /v1/medical-rep-visits/book`; search via `GET /v1/medical-reps?search=`. No patient/episode/journey.
- **FormTemplate** + **FormSection** + **FormField** — DB-stored form schemas for the builder DSL. See "Form-builder DSL" above.
- **RefreshToken** — `jti` (UUID), `token_hash` (bcrypt), `profile_id`, `organization_id`, `active_branch_id`.
- **VerificationCode** — `code_hash` (bcrypt), `purpose` (`SIGNUP | LOGIN | PASSWORD_RESET`), `expires_at`, `consumed_at`.
- **Notification** — in-app notifications.

All models have UUID primary keys, `created_at` / `updated_at`, and soft-delete fields. Lookup tables (`Role`, `JobFunction`, `SubscriptionPlan`, `Specialty`, `Procedure`) are seed-only — `prisma/seed.ts` is the source of truth, runs via `npx prisma db seed`.

`prisma/seeds/` holds self-contained per-feature seed modules called by `prisma/seed.ts`. Convention: each module is idempotent (upserts keyed on natural keys), validates its own input shape via the builder validators before any DB write, and ends with an activation transaction when relevant (e.g. flipping `FormTemplate.is_active`). See `prisma/seeds/obgyn-book-visit.ts` for the canonical example.

`prisma/seed-fixtures.ts` builds three demo organizations (jasmin, janah, amshag) with cross-org doctors. Idempotent. Refuses to run when `NODE_ENV=production`.

`prisma/` stays at repo root (Prisma CLI convention + build-time tooling). The runtime client lives at `@infrastructure/database/`.

## Environment variables

Copy `.env.example` to `.env`. `ConfigModule` loads `.env.{NODE_ENV}` then `.env`, so create `.env.test` to override vars in tests.

| Variable                             | Purpose                                         |
| ------------------------------------ | ----------------------------------------------- |
| `DATABASE_URL`                       | Neon pooler connection string                   |
| `DIRECT_URL`                         | Neon direct connection (Prisma migrations only) |
| `PORT`                               | HTTP port (default 3000)                        |
| `API_DEFAULT_VERSION`                | URI version prefix (e.g. `1`)                   |
| `CORS_ORIGINS`                       | Comma-separated allowed origins                 |
| `THROTTLE_TTL` / `THROTTLE_LIMIT`    | Rate limiting window (ms) and request cap       |
| `LOG_LEVEL`                          | `trace\|debug\|info\|warn\|error\|fatal`        |
| `SUPPORTED_LOCALES`                  | e.g. `en,ar`                                    |
| `DEFAULT_LOCALE` / `FALLBACK_LOCALE` | Locale defaults                                 |
| `JWT_ACCESS_SECRET`                  | Signing secret for access tokens                |
| `JWT_REFRESH_SECRET`                 | Signing secret for refresh tokens               |
| `JWT_RESET_SECRET`                   | Signing secret for password-reset tokens        |
| `JWT_ACCESS_EXPIRATION`              | e.g. `15m` (default)                            |
| `JWT_REFRESH_EXPIRATION`             | e.g. `7d` (default)                             |
| `JWT_REGISTRATION_EXPIRATION`        | e.g. `30m` (default)                            |
| `RESEND_API_KEY`                     | Resend API key for transactional email          |
| `RESEND_FROM_EMAIL`                  | Sender address (default `noreply@example.com`)  |
| `FREE_TRIAL_DAYS`                    | Days before free-trial subscription expires (default `14`) |
| `SENTRY_DSN`                         | Optional. Sentry DSN; absent = local dev no-op. |

Always load:
.agents/skills/prisma-cli/SKILL.md
.agents/skills/git-workflow/SKILL.md
