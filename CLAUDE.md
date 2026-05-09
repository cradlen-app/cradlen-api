# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev       # Hot-reload dev server
npm run start:debug     # Debug mode with hot-reload

# Build
npm run build           # prisma generate && nest build

# Testing
npm run test            # Unit tests (Jest)
npm run test:watch      # Watch mode
npm run test:cov        # Coverage report
npm run test:e2e        # End-to-end tests
npm run test:integration

# Single test file
npx jest src/modules/health/health.service.spec.ts

# Code quality
npm run lint            # ESLint with auto-fix
npm run format          # Prettier formatting

# Database (Prisma)
npx prisma migrate dev --name <migration-name>
npx prisma migrate dev --create-only --name <name>   # generate SQL without applying
npx prisma generate
npx prisma migrate status
npx prisma db seed                                   # canonical lookup data (roles, job functions, plans, specialties, procedures)
npm run seed:fixtures                                # 3 demo organizations (jasmin, janah, amshag) with cross-org doctors. NEVER run in production.
```

## Architecture

**Stack:** NestJS (v11) + Prisma (v7) + Neon (serverless PostgreSQL)

### Module structure

```
src/
├── app.module.ts          # Root — imports all feature modules; registers JwtAuthGuard globally
├── main.ts                # Bootstrap: Helmet, CORS, versioning, Swagger, pipes, locale
├── common/                # Shared infrastructure (never holds business logic)
│   ├── authorization/     # AuthorizationService — role/branch access checks
│   ├── decorators/        # @Public() (skip auth), @CurrentUser() (inject AuthContext)
│   ├── filters/           # GlobalExceptionFilter (maps Prisma errors → HTTP)
│   ├── guards/            # JwtAuthGuard — applied globally via APP_GUARD
│   ├── interceptor/       # ResponseInterceptor, LoggingInterceptor
│   ├── swagger/           # ApiStandardResponse, ApiPaginatedResponse, ApiVoidResponse decorators
│   └── utils/             # paginated() helper for list endpoints
├── config/                # app.config, auth.config, database.config
├── database/              # Global PrismaService (Neon adapter); exposes .db
└── modules/
    ├── auth/              # signup (3-step), login (email+phone), profile selection, refresh, logout, password reset
    ├── organizations/     # Organization CRUD
    ├── branches/          # Branch management (per-organization)
    ├── invitations/       # Email invitations + POST /invitations/bulk
    ├── profiles/          # Profile listing + update (own profile)
    ├── staff/             # Per-org staff CRUD with working-schedule support
    ├── roles/             # Role lookup (OWNER, STAFF, EXTERNAL)
    ├── specialties/       # Specialty catalog
    ├── subscriptions/     # Plan limits enforcement
    ├── calendar/          # Events (SURGERY/MEETING/PERSONAL/LEAVE), conflict detection, GET /calendar/staff suggestions
    ├── visits/            # Patient visits attached to PatientEpisode
    ├── patients/          # Patient records (cross-org via PatientJourney)
    ├── journeys/          # PatientJourney + PatientEpisode lifecycle
    ├── journey-templates/ # JourneyTemplate + EpisodeTemplate seed-driven blueprints
    ├── notifications/     # In-app notifications + event listeners
    ├── users/             # User management
    ├── mail/              # Resend-backed email (OTP + invitations)
    └── health/            # DB connectivity check
```

### Multi-org domain model

The system is multi-tenant by **Organization**. The same physical person (`User`) can belong to multiple organizations via separate `Profile` rows — one per (user, organization) pair. This is the core mental model:

- `User` = identity (email, password, phone). One per real person.
- `Profile` = membership in one organization. A user with profiles in jasmin and amshag has two Profile rows; everything operational (roles, branches, schedule, calendar events, visits) hangs off the Profile, never the User.
- Cross-org consultants (e.g. an on-demand pediatrician working at multiple clinics) get one Profile per clinic. Use `engagement_type=ON_DEMAND` and the EXTERNAL role to flag them.

### Roles vs. job functions vs. executive titles

These three axes are independent. Don't conflate them:

- **Role** (`Role` table) — authority tier. Three values, seeded: `OWNER` (manages org), `STAFF` (works inside org), `EXTERNAL` (cross-org consultant). Drives `AuthorizationService` checks.
- **JobFunction** (`JobFunction` table) — what the person actually does. Seeded clinical: `OBGYN`, `ANESTHESIOLOGIST`, `PEDIATRICIAN`, `OTHER_DOCTOR`, `NURSE`, `ASSISTANT`. Operational: `RECEPTIONIST`, `ACCOUNTANT`. Add new functions as seeds, not as Roles. Drives staff filtering (e.g. `GET /calendar/staff?job_function=PEDIATRICIAN`) and function-aware authorization in services (e.g. financial endpoints check for `ACCOUNTANT`).
- **executive_title** (enum on Profile) — `CEO | COO | CFO | CMO`. Display/governance only. Does NOT grant permissions.
- **engagement_type** (enum on Profile, default `FULL_TIME`) — `FULL_TIME | PART_TIME | ON_DEMAND | EXTERNAL_CONSULTANT`. The `GET /calendar/staff` endpoint surfaces `ON_DEMAND` profiles in the same org regardless of branch assignment.

There is intentionally no Permission table. If a finer-grained check is needed, prefer a JobFunction check in the service layer (`profile.job_functions.some(jf => jf.code === 'ACCOUNTANT')`) over inventing new roles.

### Key conventions

**Response shape:** All responses wrapped by `ResponseInterceptor` → `{ data: T, meta: {} }`. Two exceptions: returning `undefined` passes through unwrapped (use for 204 No Content); returning an object that already has a `data` or `message` key bypasses wrapping. For paginated responses return `paginated(items, { page, limit, total })` from `common/utils/pagination.utils.ts` — the interceptor detects a non-enumerable `__paginatedPayload` marker (not a shape match) and restructures to `{ data: items[], meta: { page, limit, total, totalPages } }`. Always use `paginated()`; do not construct the payload manually.

**Error shape:** `GlobalExceptionFilter` returns `{ error: { code, message, statusCode, details, requestId } }`. Prisma error mappings: P2002 → 409, P2025 → 404, P2003 → 400. The `details` structure varies:
- Validation errors: `{ fields: { [fieldName]: string[] } }`
- P2002 unique conflict: `{ fields: string[] }`
- P2003 foreign-key violation: `{ field: string }`
- All other errors: `{}`

**Database access:** Inject `PrismaService` and use `this.prismaService.db.<model>.<method>()`. Globally provided.

**Soft deletes:** Models use `is_deleted Boolean @default(false)` + `deleted_at DateTime?`. Always filter `where: { is_deleted: false }` unless intentionally fetching deleted records.

**Swagger decorators** (`common/swagger`): `@ApiStandardResponse(DtoClass)`, `@ApiPaginatedResponse(DtoClass)`, `@ApiVoidResponse()`.

**Authentication:** `JwtAuthGuard` is registered globally via `APP_GUARD` — every route requires a valid Bearer token by default. Use `@Public()` to opt out.

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
JWT strategy rejects tokens with `type !== 'access'` and calls `AuthorizationService.getProfileContext()` to populate this context per request.

**Authorization** (`common/authorization/authorization.service.ts`):
- `assertCanManageOrganization(profileId, organizationId)` — throws if not OWNER
- `assertCanManageBranch(profileId, organizationId, branchId)` — throws if not OWNER and not in branch
- `assertCanAccessBranch(...)` — read-only equivalent
- `assertCanManageStaff(profileId, organizationId)` — throws if not OWNER
- `assertCanViewStaff(...)` — broader read access
- Boolean equivalents (`canManage*` / `canAccess*`) available

### Auth flows

**Signup (3 steps):**
1. `POST /auth/signup/start` → creates `User`, sends OTP, returns `signup_token`
2. `POST /auth/signup/verify` → validates OTP, marks `verified_at`, returns fresh `signup_token`
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
- `POST /invitations/accept` — public endpoint. **Detects existing user by email**: if found, validates the supplied password against the existing account's password (security gate); creates a new `Profile` against the existing `User` rather than re-registering. This is what enables cross-org consultants like Dr. Mervat (janah OWNER → amshag STAFF).

### Calendar

- `POST /calendar/events` — when `type=SURGERY`, requires `branch_id`, `patient_id`, AND `procedure_id` (FK to `Procedure`). Other types optional.
- `GET /calendar/staff?job_function=&branch_id=&starts_at=&ends_at=` — returns candidate profiles for a slot. Filters: profiles in the org with the requested `JobFunction`, either assigned to the branch via `ProfileBranch` OR `engagement_type=ON_DEMAND`. Reuses `CalendarConflictsService` for a single bulk conflict check, then tags each candidate with `has_conflict` + the conflict descriptors.
- `CalendarConflictsService.findConflicts(...)` — checks calendar event overlaps, visit overlaps, and out-of-schedule windows in parallel for a list of profile IDs.

### Versioning, logging, locale

- **Versioning:** URI-based (`/v1/...`). Default version from `API_DEFAULT_VERSION`.
- **Logging:** Pino — pretty in dev, JSON in prod. Request ID propagated via `x-request-id` header.
- **Locale:** `Accept-Language` parsed per request; allowed locales from `SUPPORTED_LOCALES`.

**ESLint rules enforced as errors:** `no-explicit-any`, `no-floating-promises`, `no-unsafe-argument`, `no-unused-vars` (allow `_` prefix), `no-misused-promises`. Run `npm run lint` before committing.

### Adding a new module

1. Create `src/modules/<feature>/` with controller, service, module files.
2. Import the module in `AppModule`.
3. Inject `PrismaService` directly.
4. Use `@CurrentUser() user: AuthContext` and call `AuthorizationService` for role/branch checks.
5. Use `paginated(...)` for list endpoints.
6. Decorate controllers with `@ApiStandardResponse` / `@ApiPaginatedResponse` / `@ApiVoidResponse`.
7. Add Prisma models to `prisma/schema.prisma`; run `npx prisma migrate dev`.

### Data model (`prisma/schema.prisma`)

Core entities:

- **Organization** → many **Branch**, **Profile**, **Subscription**, **Invitation**, **PatientJourney**, **CalendarEvent**, **OrganizationSpecialty**
- **Branch** → unique `(id, organization_id)` so M2M tables can FK against the composite key
- **User** → many **Profile**, **RefreshToken**, **VerificationCode**
- **Role** → many **ProfileRole**, **InvitationRole**. Seeded: `OWNER`, `STAFF`, `EXTERNAL`. (Legacy `DOCTOR` / `RECEPTIONIST` were removed in the multi-org refactor.)
- **JobFunction** → many **ProfileJobFunction**, **InvitationJobFunction**. Seeded with the clinical/operational set described above. `is_clinical` is a column on `JobFunction`, not on `Profile`.
- **Profile** — `(user_id, organization_id)` unique. Carries `executive_title?` and `engagement_type` (default `FULL_TIME`). Job functions and specialties live in M2M tables (`ProfileJobFunction`, `ProfileSpecialty`), not as columns. Branches via `ProfileBranch`.
- **Invitation** — pre-assigns roles, branches, job functions, specialties, executive_title, engagement_type. Accept flow copies these onto the new Profile.
- **Specialty** — catalog (`code` unique). Linked to `Procedure`, `JourneyTemplate`, and to `Profile`/`Organization`/`Invitation` via M2M.
- **Procedure** — surgery catalog (e.g. `CESAREAN_SECTION`). FK from `CalendarEvent.procedure_id` (required when `type=SURGERY`).
- **WorkingSchedule** → **WorkingDay** → **WorkingShift** — per (profile, branch).
- **Patient** → many **PatientJourney** → many **PatientEpisode** → many **Visit**.
- **CalendarEvent** + **CalendarEventParticipant** — surgery scheduling, meetings, leave, personal events.
- **RefreshToken** — `jti` (UUID), `token_hash` (bcrypt), `profile_id`, `organization_id`, `active_branch_id`.
- **VerificationCode** — `code_hash` (bcrypt), `purpose` (`SIGNUP | LOGIN | PASSWORD_RESET`), `expires_at`, `consumed_at`.
- **Notification** — in-app notifications.

All models have UUID primary keys, `created_at` / `updated_at`, and soft-delete fields. Lookup tables (`Role`, `JobFunction`, `SubscriptionPlan`, `Specialty`, `Procedure`) are seed-only — `prisma/seed.ts` is the source of truth, runs via `npx prisma db seed`.

`prisma/seed-fixtures.ts` builds three real-world demo organizations (jasmin, janah, amshag) with cross-org doctors and a sample C-section calendar event. Idempotent. Refuses to run when `NODE_ENV=production`.

## Environment variables

Copy `.env.example` to `.env`. Required vars:

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
| `JWT_ACCESS_EXPIRATION`              | e.g. `15m` (default)                            |
| `JWT_REFRESH_EXPIRATION`             | e.g. `7d` (default)                             |
| `JWT_REGISTRATION_EXPIRATION`        | e.g. `30m` (default)                            |
| `RESEND_API_KEY`                     | Resend API key for transactional email          |
| `RESEND_FROM_EMAIL`                  | Sender address (default `noreply@example.com`)  |
| `FREE_TRIAL_DAYS`                    | Days before free-trial subscription expires (default `14`) |

`ConfigModule` loads `.env.{NODE_ENV}` then `.env`, so create `.env.test` to override vars in tests.

Always load:
.agents/skills/prisma-cli/SKILL.md
.agents/skills/git-workflow/SKILL.md
