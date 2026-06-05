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

# Test layout: unit tests are co-located as *.spec.ts next to source under src/.
# Integration tests (test/jest-integration.json) and e2e (test/jest-e2e.json) live under test/.
# Integration tests expect a .env.test override of DATABASE_URL — create one before running.

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
├── main.ts                   # First import is '@infrastructure/monitoring/sentry' (must stay first — Sentry's instrumentation must register before any other module is loaded)
├── app.module.ts             # Wires Sentry + MessagingModule + ConfigModule + Throttler + every core module; registers JwtAuthGuard + ThrottlerGuard globally
├── common/                   # Foundation: decorators, filters, guards, interceptors, pipes, swagger helpers, paginated() utility
├── config/                   # @nestjs/config factories — env var schemas (app, auth, database)
├── infrastructure/           # Adapters wrapping vendor SDKs
│   ├── database/             # PrismaService (.db getter), DatabaseModule (@Global)
│   ├── messaging/            # EventBus facade over EventEmitter2; realtime/ Socket.IO gateways
│   ├── email/                # Resend wrapper (EmailService, EmailModule @Global)
│   ├── logging/              # Pino logger
│   ├── monitoring/           # Sentry init (sentry.ts; preloaded via main.ts first import)
│   ├── storage/              # Cloudflare R2 (S3-compatible) wrapper (StorageService, StorageModule @Global) — presigned PUT/GET, private bucket
│   └── cache, queue, sms/    # Stub READMEs — no consumer yet
├── core/                     # Domain layer
│   ├── auth/                 # auth (3-step signup, login, OTP, password reset) + authorization/ (role/branch checks)
│   ├── org/                  # organizations, branches, profiles, staff, invitations, roles, job-functions, specialty-catalog (the Specialty lookup — distinct from the src/specialties/ vertical layer), procedures, subscriptions
│   ├── patient/              # patients/ (records, cross-org via PatientJourney; OverdueVisitSweepService marks past-due, never-checked-in visits NO_SHOW nightly), guardians/
│   ├── calendar/             # Per-profile calendar events; publishes CALENDAR_EVENTS (created/updated/deleted) — see calendar.events.ts
│   ├── clinical/             # visits/ (booking + intake write path; + encounter-mutation guard), care-paths/, medications/ (drug catalog search), diagnosis-codes/ (ICD-10 catalog search), chief-complaints/, medical-rep/, journeys/ (read-only journey descriptor), events/ (domain-events catalog). Visit clinical data is written via booking intake (visits.service.applyIntake) and the OB/GYN examination tab — there is no generic clinical CRUD module. (The journey-templates/ and lab-tests/ read/CRUD API modules were removed as unused — their tables remain and the booking flow still resolves templates and creates journeys/episodes internally.)
│   ├── financial/            # services/ (billable-service catalog), pricing/ (price lists, provider services/overrides, 3-tier price resolver), invoices/ (invoice + items + payments lifecycle)
│   ├── notifications/        # In-app notifications + listener that maps invitation events → notifications
│   └── health/               # DB connectivity probe
├── builder/                  # Form-builder DSL — fields, sections/, rules, runtime, renderer, validator, templates (workflows/ still empty)
├── specialties/              # Vertical specialty modules — sibling layer to plugins. Currently obgyn/ (visit-examination, patient-history, amendments, history-summary)
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

- **Role** (`Role` table) — authority tier. Seeded: `OWNER` (manages org and grants any role), `BRANCH_MANAGER` (manages staff and acts as OWNER within their assigned branches), `STAFF` (works inside org), `EXTERNAL` (cross-org consultant). Drives `AuthorizationService` checks. Only `OWNER` may grant `OWNER` or `BRANCH_MANAGER` via invitations — `AuthorizationService.assertNoPrivilegedRoleAssignment` blocks anyone else.
- **JobFunction** (`JobFunction` table) — what the person does. Seeded clinical: `OBGYN`, `ANESTHESIOLOGIST`, `PEDIATRICIAN`, `OTHER_DOCTOR`, `NURSE`, `ASSISTANT`. Operational: `RECEPTIONIST`, `ACCOUNTANT`. Add new functions as seeds, not as Roles. Drives staff filtering and function-aware service-layer checks. (As of now the financial endpoints gate on `assertCanManageOrganization`, not on `ACCOUNTANT` — prefer a JobFunction predicate when you do add finer-grained billing checks.)
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

**OTP:** 15-minute TTL, max 5 attempts. Resend cooldown 60s, max 5 resends/hour. `RegistrationCleanupService` purges PENDING users older than 24h hourly. `OverdueVisitSweepService` (`src/core/patient/patients/`) runs a nightly cron (02:00) that marks past-due, never-checked-in `SCHEDULED` visits as `NO_SHOW`.

**Password reset:** `POST /auth/forgot-password` → `POST /auth/verify-reset-code` → `POST /auth/reset-password`.

### Invitations

- `POST /organizations/:orgId/invitations` — single invite. DTO accepts `email`, `first_name`, `last_name`, `phone_number?`, `role_ids[]`, `branch_ids[]`, `job_function_codes?[]`, `specialty_codes?[]`, `executive_title?`, `engagement_type?`. Validates that codes exist in their respective tables.
- `POST /organizations/:orgId/invitations/bulk` — array of up to 100. Single transaction for DB inserts (rolls back on any error); emails sent after commit; per-email failures returned in the response (`{ id, email, email_sent }`).
- `POST /invitations/accept` — public endpoint. **Detects existing user by email**: if found, validates the supplied password against the existing account's password (security gate); creates a new `Profile` against the existing `User` rather than re-registering. This is what enables cross-org consultants (e.g. janah OWNER → amshag STAFF).

### CarePath vs JourneyTemplate

Two distinct but related structural concepts — do not conflate:

- **`CarePath`** (`src/core/clinical/care-paths/`) — a clinical pathway defining an ordered set of `CarePathEpisode` steps for a specialty. Can be system-wide (`organization_id = null`) or org-specific. The `specialty_code` on a booking selects which care path the visit's journey follows. Read-only API at `GET /v1/care-paths`.
- **`JourneyTemplate`** (table only — the `journey-templates/` read API was removed as unused) — a blueprint for creating `PatientJourney` + `PatientEpisode` rows. Has a `code` (unique per specialty) and `scope`. The booking flow resolves the template from `specialty_code` + `care_path_code` (via Prisma) and creates the journey/episode structure automatically.
- **`PatientJourney`** → **`PatientEpisode`** → **`Visit`** — the runtime instances created from templates. Created and advanced within the booking flow (`visits.service`); the standalone `journeys/` API module was removed as unused (the tables remain).

At booking time (`bookVisit`), the service: resolves `specialty_code` → `specialty_id` → picks the correct `CarePath` → finds the matching `JourneyTemplate` by code → creates `PatientJourney` + first `PatientEpisode` if not already active.

### Journey-centric clinical chart

One patient = one chart holding a **sequence** of time-bounded journeys; **exactly one is ACTIVE at a time** (`PatientJourney.status=ACTIVE`, `ended_at` null) — journeys are sequential, never concurrent. A **visit** is an encounter within the active journey and serves two things at once: the **presenting encounter** (Examination tab, visit-scoped, `examination_version`) and the **active journey's surveillance** (the journey tab, with its **own** version token). E.g. a pregnant woman presenting with pelvic pain → one *Examination* entry (pelvic-pain workup) + one *Pregnancy* entry (journey profile + today's maternal/fetal check), both under the single active pregnancy journey.

- **Surface declaration.** A care path may declare a clinical surface via `CarePathClinicalSurface` (template + label). When present, the visit workspace renders **one** dynamic journey tab; when absent, none. Seeded empty today → mechanism dormant.
- **Descriptor endpoint (live).** `GET /v1/visits/:visitId/journey` → `JourneyDescriptorDto | null` (`JourneysModule`, `src/core/clinical/journeys/`). Resolves the visit's own episode → journey (the active one for a live visit) and folds in the declared surface; gates via `PatientAccessService.assertVisitInOrg`. `clinical_surface` is null when the care path declares none.
- **Surface read/write (contract; writer deferred to the pregnancy vertical).** `GET`/`PATCH /v1/visits/:visitId/journeys/:journeyId/clinical` — flat envelope `{ journey_id, version, …journey + per-visit fields }`, `If-Match: "version:N"`, composite write across the journey/episode/visit scoped records (`PregnancyJourneyRecord` / `PregnancyEpisodeRecord` / `VisitPregnancyRecord`) in one transaction with `*_revisions` shadows + the `journey.clinical.updated` event (`@core/clinical/events`). The backend demuxes each field into the right scoped record by binding namespace (the surface envelope is flat — no FE namespace containers).
- Full standard: `cradlen-web/docs/superpowers/specs/journey-centric-clinical-chart.md`.

### OB/GYN specialty surfaces

`src/specialties/obgyn/` exposes multiple controller groups, each mapping to a UI tab:

- **`visit-examination/`** — the single open-visit encounter write path, ordered as a real clinical visit: **main complaint → care path → care-path-relevant patient history → exam findings → provisional diagnosis → treatment plan**. One GET/PATCH pair aggregating encounter scalar fields (chief complaint, diagnosis, clinical reasoning, `case_path`), all 10 body-system findings sections (general/cardiovascular/respiratory/menstrual/abdominal/pelvic/breast/extremities/neurological/skin on `VisitObgynEncounter`), vitals, investigations, and medications. Uses `Visit.examination_version` for optimistic concurrency. `@LocksOnClosedVisit('id')` (closed visits are edited only via `amendments/`).
  - **Care-path-driven history capture.** The `obgyn_examination` template (v2) embeds the patient-history sections as `history_*` sections (bound to `PATIENT_OBGYN_HISTORY.*`); which ones surface is driven by the chosen care path via `CarePathHistorySection` (exposed on `CarePathDto.history_section_codes`). The PATCH DTO carries an optional `obgyn_history` (the full `UpdateObgynHistoryDto`); the service routes it to `ObgynHistoryService.applyPatch(tx, patientId, dto, null, profileId)` **inside the same transaction** (`null` If-Match — the visit's `examination_version` already guards concurrency). This writes the patient-level `PatientObgynHistory` tables (single source of truth) + revision + `version` bump + `patient.history.updated`, feeding the read-only full-history tab. The GET hydrates `obgyn_history` from the patient's current record (and defaults `case_path` to the journey's care path) so the sections pre-fill. The history section specs are authored once in `prisma/seeds/obgyn-patient-history.ts` (`HISTORY_SECTIONS` / `buildHistorySections`) and embedded into the exam seed — single source of truth.
- **`patient-history/`** — patient-level (not visit-scoped) OB/GYN history singleton. **Read-only over HTTP**: `GET /patients/:id/obgyn-history` is the "specialty full history" view — the envelope includes the five child collections (allergies, contraceptives, non-gyn surgeries, medications, pregnancies) plus the singleton `version`. There is **no** standalone PATCH; history capture happens in the examination flow. `ObgynHistoryService` (id-keyed child diff, version + revision, obstetric-summary recompute) is the **internal writer**: `applyPatch(tx, patientId, dto, ifMatchVersion|null, profileId)` is the transaction-composable core (the examination PATCH calls it with `null` If-Match inside its own transaction); `patch()` is the HTTP-style wrapper. `readEnvelope(patientId, tx?)` is a no-access-check, no-lazy-create read used to embed history into the examination GET. The matching form template `obgyn_patient_history` is `is_display_only` (see below). Patient history is specialty-shaped, so there is **no** generic/core patient-history surface — each specialty owns its own. (Org-scoping access checks live in the shared `@core/patient/patient-access` module — `PatientAccessService` with `assertPatientInOrg` / `assertVisitInOrg` — imported by both `PatientsModule` and `ObgynModule`.)
- **`history-summary/`** — read-only aggregation of the patient's OB/GYN history, allergies, and medications into a single envelope for the sidebar/summary panel.
- **`amendments/`** — the only legal write path for closed visits. The `If-Match` precondition echoes the *target row's* own `version`: for `obgyn_encounter` read it from the examination GET's `obgyn_encounter_version` field.

### Clinical reference catalogs (entity-search backed)

Two seed-managed catalogs back the form-builder `ENTITY_SEARCH` pickers in the examination (each `kind` is registered on the API `ENTITIES` registry and mirrored by the FE entity registry; the resolved id lands in the field's `idTarget`/`fillFields`):

- **`DiagnosisCode`** (`diagnosis-codes/`) — system-wide ICD-10 catalog. `GET /v1/diagnosis-codes?search=` (`@Public()`) matches code/description/keywords with optional `specialty_code`; seeded by `prisma/seeds/diagnosis-codes-obgyn.ts`. `source` is `SYSTEM | USER`: a doctor-entered code not yet in the catalog is inserted as a `USER` row (with `created_by_id`) by the examination PATCH (`diffDiagnoses` → `registerNovelDiagnosisCodes`). `VisitDiagnosis.code` stores the value by string (no FK — free entry stays valid).
- **`Medication`** (`medications/`) — org-scoped drug catalog (global `organization_id = null` rows + per-org rows; `added_by_id` = authoring profile). `GET /v1/medications?search=` (auth-gated, paginated) matches name/generic_name/code via `orgScopedReadFilter` (global ∪ caller's org); seeded in `prisma/seed.ts`. The examination drug picker auto-fills the prescription line's dose/frequency + instructions from the catalog medication's defaults/notes; a free-typed drug persists on the visit only (`PrescriptionItem.custom_drug_name`, `medication_id` null — no catalog write).

### Clinical write-path: immutability, amendments, revisions

Closed-visit clinical data is treated as a legal record. Three complementary mechanisms enforce that:

**1. Encounter-mutation guard.** Section-level `PATCH` endpoints on a visit's clinical surface are blocked once `visit.status` is `COMPLETED` or `CANCELLED`.

- `EncounterMutationGuard` (`@core/clinical/visits/encounter-mutation.guard.ts`) — class-level `@UseGuards`.
- `@LocksOnClosedVisit('paramName')` decorator (`@common/decorators/locks-on-closed-visit.decorator.ts`) — opt each PATCH in. Default param is `id`. GETs pass through.
- Blocked requests return `409 ENCOUNTER_LOCKED` with the amendment endpoint hinted in `error.details`.
- `VisitsModule` exports the guard; specialty modules import `VisitsModule` to resolve it.

**2. Amendments.** `POST /v1/visits/:visitId/amendments` is the only legal write path after close.

- Authority: the visit's `assigned_doctor_id` OR an `OWNER` of the org.
- Requires `reason` (min 8 chars) and an `If-Match` version precondition.
- Targets: `obgyn_encounter` (visit-scoped). Patient-level (`patient_obgyn_history`) is validated but not yet routed.
- Response includes `{ target, section, version_from, version_to, amended_by_id, reason, amended_at }` for audit.

**3. Revisions (audit shadow tables).** Every PATCH and amendment writes the prior row to a paired `*_revisions` table inside the same Prisma transaction as the live-row update.

- Tables actively written (all `…_revisions`): `patient_obgyn_history`, `visit_obgyn_encounter`. (The `pregnancy_journey_record`, `pregnancy_episode_record`, `visit_pregnancy_record` revision tables remain in the schema but are unused while the pregnancy module is out.)
- Shape: `(id, entity_id FK, version, snapshot Json, changed_fields Json, revised_by_id FK profile, revised_at, revision_reason?)`. `version` is the SNAPSHOT version — the live-row version BEFORE the change. Append-only.
- Helper: `buildRevision(prior, changedFields, revisedById, reason?)` in `@specialties/obgyn/revisions.helper`. Callers own the Prisma transaction so live-row + revision are atomic. PATCH leaves `revision_reason` null; amendments pass `dto.reason`.

**4. Bulk section PATCH per tab.** OB/GYN section PATCHes are collapsed into one bulk PATCH per tab (one transaction → one revision row covering all changed fields). When adding new specialty surfaces, follow that pattern rather than one-section-per-endpoint.

**5. Clinical domain-events catalog.** Event names for downstream consumers (notifications, AI assistants, analytics, referrals) live in `@core/clinical/events/clinical-events.ts` and are re-exported via `events.public.ts`. Publish through `EventBus`; do not invent ad-hoc event strings.

### Financial / billing (`src/core/financial/`)

Org-scoped billing under `FinancialModule` (three sub-modules). All routes are `organizations/:orgId/...` and gate on `AuthorizationService.assertCanManageOrganization` / `assertCanAccessBranch`.

- **`services/`** — the billable-service catalog (`Service`, `ServiceType` = `CONSULTATION | PROCEDURE | LAB_TEST | IMAGING | ADMINISTRATIVE | OTHER`), optionally linked to specialties via `ServiceSpecialty`. CRUD at `organizations/:orgId/financial/services`.
- **`pricing/`** — three concepts:
  - **Price lists** (`PriceList` → `PriceListItem`) — org-level or branch-level, with a `is_default` flag per scope. CRUD at `organizations/:orgId/financial/price-lists`.
  - **Provider services / overrides** (`ProviderService`, `ProviderPriceOverride`) — authorize which services a provider may bill and set per-provider, time-bounded (`valid_from`/`valid_to`) price overrides. Routes under `organizations/:orgId/providers/:profileId/{services,price-overrides}`.
  - **Price resolver** (`PricingResolverService`, `GET organizations/:orgId/financial/resolve-price`) — resolves the effective price by precedence: **provider override → branch default price list → org default price list** (else `null`). The chosen tier is reported as `PricingSource` (`PROVIDER_OVERRIDE | BRANCH_OVERRIDE | ORG_PRICE_LIST | CUSTOM`).
- **`invoices/`** — `Invoice` → `InvoiceItem` + `Payment`. Lifecycle: `DRAFT → ISSUED → PARTIALLY_PAID → PAID` (plus `REFUNDED`, `VOID`); items are mutable only while `DRAFT`. Endpoints: create/list/get/patch, `:id/items` add + `:id/items/:itemId` remove, `:id/issue`, `:id/void`, `:id/payments` record + list. Invoice numbers come from `InvoiceNumberService.generate()` — an atomic upsert on `InvoiceSequence (organization_id, year)` producing `INV-<year>-<5-digit-seq>`. `InvoiceType` = `STANDARD | FOLLOWUP | PROFORMA | INSURANCE | REFUND`; insurance flows have an `InvoiceInsuranceClaim` shadow.

Unit-priced amounts are Prisma `Decimal` — never coerce to JS `number` for arithmetic.

### Form-builder DSL (`src/builder/`)

DB-stored form templates the frontend renders against. Authored in code (`prisma/seeds/`), never via admin endpoints — templates are code-managed (the only sanctioned write path is `prisma db seed`).

**Subfolder roles:**

- `sections/` — `SectionDescriptor` and `SectionConfigSchema` — schema types for declaring section-level config within a template. One descriptor per section kind; the seed validates against this before writing.
- `fields/` — `FIELD_TYPES` registry (per-field-type config invariants), `ENTITIES` registry (the extension point for `ENTITY_SEARCH` — one entry per searchable kind, not a new `FormFieldType`), `ALLOWED_PATHS` map enforcing binding integrity at seed time (typos throw before any DB write), namespaced `ConfigShape` validator (`{ui, validation, logic}` only — no flat keys).
- `rules/` — `Predicate { effect, when, message? }` types + pure `evaluate()` function. Operators: `eq` / `ne` / `in` / `contains` / `and` / `or`. Effects: `visible` and `enabled` are UI-only; `required` and `forbidden` are server + UI. The server **never** consumes `visible` — a hidden-in-UI field can still be 400-rejected if its `required` predicate is true.
- `runtime/` — `TemplateExecutionContext` indexes an in-flight payload by field code for predicate evaluation.
- `renderer/` — strips internal columns (`is_deleted`, `created_by_id`, …) and attaches the typed `TemplateBindingContract` per field.
- `validator/` — `TemplateValidator.validatePayload(code, payload, options?)` walks fields and enforces `required` + `forbidden` predicates (column-level `required` plus triggered `required`/`forbidden` predicate effects; `visible`/`enabled` are never consumed server-side). Wired into the `book_visit` flow in `visits.service.ts` (with `extensionKey` for the OB/GYN extension) and `medical-rep.service.ts`. `options.sparse` skips required checks for PATCH while still enforcing `forbidden`.
- `templates/` — read-only API: `GET /v1/form-templates` (active rows), `GET /v1/form-templates/:code` (the active version), `GET /v1/form-templates/:code/versions/:version` (specific version, for stale-cache reads during rollback). The full binding contract + search-field two-bucket lifecycle + discriminator state-reset rule live in `src/builder/templates/templates.README.md`.

**Binding namespaces** (`BindingNamespace`): `PATIENT`, `VISIT`, `INTAKE`, `GUARDIAN`, `MEDICAL_REP`, `LOOKUP` (data-bound search/picker widgets — value submitted is the resolved ID), `SYSTEM` (pure flow-control, never persisted, e.g. the `visitor_type` discriminator), `COMPUTED` (server recomputes — e.g. BMI from weight/height; client value advisory).

**Active-version pointer.** `FormTemplate.is_active` + `activated_at` plus a partial unique index `(code) WHERE is_active=true AND is_deleted=false` (raw SQL in the migration — Prisma `@@unique` doesn't support `WHERE`). Read path is `WHERE is_active=true`, NEVER `max(version)`. Rollback is a pointer flip in a `$transaction([deactivate-others, activate-this])`.

**Display-only templates.** `FormTemplate.is_display_only` (Boolean, default false) marks a template that renders read-only in the frontend (no input controls) and is never a write target. The renderer surfaces it on `RenderedTemplate`; `TemplateValidator.validatePayload` rejects any submission carrying bound values against a display-only template (`FORBIDDEN`). The OB/GYN `obgyn_patient_history` template is `is_display_only` — it backs the read-only "specialty full history" view.

**Seed governance.** Templates are upserted by `(code, version)`; the activation transaction at the end of each seed function deactivates prior versions and marks the new one PUBLISHED. The `ALLOWED_PATHS` map is cross-checked against the actual DTO classes (`BookVisitDto`, `BookMedicalRepVisitDto`, `UpsertVitalsDto`, `ChiefComplaintMetaDto`) by `src/builder/fields/allowed-paths.contract.spec.ts` via class-validator metadata introspection — a DTO rename without an `ALLOWED_PATHS` update fails CI at the moment of the rename. **DTOs for template-driven flows must stay thin** (type/shape only, no `@ValidateIf`). When a new template lands, all conditional logic goes into `config.logic.predicates`, not into class-validator decorators.

### Versioning, logging, locale

- **Versioning:** URI-based (`/v1/...`). Default version from `API_DEFAULT_VERSION`.
- **Logging:** Pino — pretty in dev, JSON in prod. Request ID propagated via `x-request-id` header. Logs are tee'd into Sentry's logging stream.
- **Locale:** `Accept-Language` parsed per request; allowed locales from `SUPPORTED_LOCALES`.

**ESLint rules enforced as errors:** `no-explicit-any`, `no-floating-promises`, `no-unsafe-argument`, `no-unused-vars` (allow `_` prefix), `no-misused-promises`, plus the layer-boundary `import/no-restricted-paths` zones above. Run `npm run lint` before committing.

### Adding a new feature

1. Decide its layer:
   - Domain feature with its own endpoints → `src/core/<bucket>/<feature>/` (pick the right bucket: `auth | org | patient | calendar | clinical | financial | notifications | health`).
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
- **Visit** — now carries `specialty_code String?`, `form_template_id UUID?` (FK to the active template used at booking), and `examination_version Int @default(1)` (optimistic-lock token for the unified examination tab, bumped by `visit-examination/` PATCH).
- **Visit.appointment_type** is `VISIT | FOLLOW_UP`. `MEDICAL_REP` visits live in a separate table — see below.
- **CarePath** + **CarePathEpisode** — clinical pathway definitions (system or org-specific). Filtered by `specialty_code` + org scope at query time.
- **CarePathHistorySection** — `(specialty_code, care_path_code, section_code)` lookup mapping a care path to the patient-history sections relevant to it (string-keyed, like `ChiefComplaintCategory` — no FK). Surfaced on `CarePathDto.history_section_codes`; drives which embedded `history_*` sections the OB/GYN examination surfaces. Seeded by `prisma/seeds/care-path-history-sections.ts`.
- **CarePathClinicalSurface** — `(specialty_code, care_path_code)` → `{ template_code, label, order }` lookup (string-keyed, like `CarePathHistorySection` — no FK). Declares the optional **journey clinical surface** for a care path (the form template backing the active-journey tab). Seeded **empty** today (`prisma/seeds/care-path-clinical-surfaces.ts`) — the pregnancy vertical adds the `OBGYN_PREGNANCY` row. See "Journey-centric clinical chart" below.
- **JourneyTemplate** — visit/episode blueprint with `code` (unique per specialty) and `scope`. The booking flow resolves template → creates PatientJourney + PatientEpisode.
- **CalendarEvent** — per-profile calendar entries with `event_type`, `visibility`, optional `branch_id`. Managed by `CalendarModule`; publishes `CALENDAR_EVENTS`.
- **MedicalRep** + **MedicalRepVisit** + **MedicalRepMedication** + **MedicalRepVisitMedication** — org-scoped pharma rep visits. Booked via `POST /v1/medical-rep-visits/book`; search via `GET /v1/medical-reps?search=`. No patient/episode/journey.
- **DiagnosisCode** — system-wide ICD-10 catalog (`@@unique(code)`, `source SYSTEM|USER`, `created_by_id`). Search-only over HTTP; `VisitDiagnosis.code` references it by value (no FK). See "Clinical reference catalogs".
- **Medication** — drug catalog, global or per-org (partial unique `(organization_id, code)` on live rows; `added_by_id`). Backs the `PrescriptionItem.medication_id` FK and the examination drug picker.
- **Service** + **ServiceSpecialty** — billable-service catalog (org-scoped, `ServiceType`), optionally specialty-linked. See "Financial / billing" above.
- **PriceList** + **PriceListItem** + **ProviderService** + **ProviderPriceOverride** — pricing tiers resolved by `PricingResolverService` (provider override → branch → org). Prices are `Decimal`.
- **Invoice** + **InvoiceItem** + **Payment** + **InvoiceSequence** + **InvoiceInsuranceClaim** — invoicing lifecycle; `InvoiceSequence (organization_id, year)` backs `INV-<year>-<seq>` numbering.
- **FormTemplate** + **FormSection** + **FormField** — DB-stored form schemas for the builder DSL. See "Form-builder DSL" above.
- **RefreshToken** — `jti` (UUID), `token_hash` (bcrypt), `profile_id`, `organization_id`, `active_branch_id`.
- **VerificationCode** — `code_hash` (bcrypt), `purpose` (`SIGNUP | LOGIN | PASSWORD_RESET`), `expires_at`, `consumed_at`.
- **Notification** — in-app notifications.

All models have UUID primary keys, `created_at` / `updated_at`, and soft-delete fields. Lookup tables (`Role`, `JobFunction`, `SubscriptionPlan`, `Specialty`, `Procedure`) are seed-only — `prisma/seed.ts` is the source of truth, runs via `npx prisma db seed`.

`prisma/seeds/` holds self-contained per-feature seed modules called by `prisma/seed.ts`. Convention: each module is idempotent (upserts keyed on natural keys), validates its own input shape via the builder validators before any DB write, and ends with an activation transaction when relevant (e.g. flipping `FormTemplate.is_active`). See `prisma/seeds/obgyn-book-visit.ts` for the canonical example. Ordering matters: `prisma/seed.ts` runs lookup seeds (roles, job functions, plans, specialties, procedures) before feature seeds — register new seed modules there so dependencies resolve.

Current seed modules: `book-visit.ts` (general visit template), `book-visit-shell.ts` (shell template), `obgyn-book-visit.ts` (OB/GYN booking form — canonical template example), `obgyn-examination.ts` (examination tab template), `obgyn-patient-history.ts` (patient history template), `chief-complaint-categories.ts` (lookup categories), `diagnosis-codes-obgyn.ts` (OB/GYN ICD-10 diagnosis catalog), `care-path-history-sections.ts`, `care-path-clinical-surfaces.ts`.

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
| `R2_ACCOUNT_ID`                      | Cloudflare R2 account id (object storage)       |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 S3 API credentials                    |
| `R2_BUCKET`                          | R2 bucket name (private)                        |
| `R2_ENDPOINT`                        | Optional. Defaults to `https://<account>.r2.cloudflarestorage.com` |
| `R2_PRESIGN_PUT_TTL_SECONDS` / `R2_PRESIGN_GET_TTL_SECONDS` | Presigned URL TTLs (default `300`) |
| `R2_MAX_UPLOAD_BYTES`                | Max upload size (default `15000000`)            |
| `R2_ALLOWED_CONTENT_TYPES`           | Comma-separated MIME allowlist (default pdf/png/jpeg/webp) |
| `SENTRY_DSN`                         | Optional. Sentry DSN; absent = local dev no-op. |

Always load:
.agents/skills/prisma-cli/SKILL.md
.agents/skills/git-workflow/SKILL.md
