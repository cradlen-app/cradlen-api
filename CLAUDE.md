# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev       # Hot-reload dev server
npm run start:debug     # Debug mode with hot-reload

# Build
npm run build           # Compile with nest CLI

# Testing
npm run test            # Unit tests (Jest)
npm run test:watch      # Watch mode
npm run test:cov        # Coverage report
npm run test:e2e        # End-to-end tests

# Single test file
npx jest src/modules/health/health.service.spec.ts

# Code quality
npm run lint            # ESLint with auto-fix
npm run format          # Prettier formatting

# Database (Prisma)
npx prisma migrate dev --name <migration-name>
npx prisma generate
npx prisma migrate status
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
│   ├── constant/          # App constants and error codes
│   ├── decorators/        # @Public() (skip auth), @CurrentUser() (inject AuthContext)
│   ├── dto/               # ApiResponse interfaces, PaginatedPayload types
│   ├── filters/           # GlobalExceptionFilter (maps Prisma errors → HTTP)
│   ├── guards/            # JwtAuthGuard — applied globally via APP_GUARD
│   ├── interceptor/       # ResponseInterceptor, LoggingInterceptor
│   ├── interfaces/        # AuthContext interface
│   ├── logger/            # Pino logger factory
│   ├── middleware/        # RequestIdMiddleware (UUID per request)
│   ├── swagger/           # ApiStandardResponse, ApiPaginatedResponse, ApiVoidResponse decorators
│   ├── utils/             # paginated() helper for list endpoints
│   └── validators/        # @MatchesField(field) — cross-field equality validator
├── config/
│   ├── app.config.ts      # PORT, CORS, throttle, locale, versioning
│   ├── auth.config.ts     # JWT secrets/expiry, Resend API key, free trial days
│   └── database.config.ts # DATABASE_URL
├── database/
│   ├── database.module.ts # Global module — exports PrismaService everywhere
│   └── prisma.service.ts  # PrismaClient with Neon adapter; exposes .db property
└── modules/
    ├── auth/              # Full auth flows: signup, login (email+phone), profile selection, refresh, logout, password reset
    ├── accounts/          # Account CRUD (get, update)
    ├── branches/          # Branch management
    ├── invitations/       # Email invitations to join an account
    ├── join-codes/        # One-time join codes for staff onboarding
    ├── profiles/          # Profile management (/auth/me equivalent)
    ├── roles/             # Role lookup
    ├── users/             # User management
    ├── mail/              # Resend-backed email (OTP and invitation emails)
    └── health/            # DB connectivity check (reference module)
```

### Key conventions

**Response shape:** All responses wrapped by `ResponseInterceptor` → `{ data: T, meta: {} }`. Two exceptions: returning `undefined` passes through unwrapped (use for 204 No Content); returning an object that already has a `data` or `message` key bypasses wrapping and is returned as-is. For paginated responses return `paginated(items, { page, limit, total })` from `common/utils/pagination.utils.ts` — the interceptor detects a non-enumerable `__paginatedPayload` marker set by that helper (not by shape) and restructures to `{ data: items[], meta: { page, limit, total, totalPages } }`. Always use `paginated()` — do not construct the payload manually.

**Error shape:** `GlobalExceptionFilter` returns `{ error: { code, message, statusCode, details, requestId } }`. Prisma error mappings: P2002 → 409, P2025 → 404, P2003 → 400. The `details` structure varies by error type:
- Validation errors (`BadRequestException`): `{ fields: { [fieldName]: string[] } }`
- P2002 unique conflict: `{ fields: string[] }` (conflicting column names)
- P2003 foreign-key violation: `{ field: string }` (offending column name)
- All other errors: `{}`

**Database access:** Inject `PrismaService` and use `this.prismaService.db.<model>.<method>()`. `PrismaService` is globally provided — no need to import `DatabaseModule` in feature modules.

**Soft deletes:** Models use `is_deleted Boolean @default(false)` + `deleted_at DateTime?`. Always filter `where: { is_deleted: false }` in queries unless fetching deleted records intentionally.

**Swagger decorators** (from `common/swagger`):

- `@ApiStandardResponse(DtoClass)` — single resource endpoints
- `@ApiPaginatedResponse(DtoClass)` — list endpoints
- `@ApiVoidResponse()` — 204 No Content endpoints

**Authentication:** `JwtAuthGuard` is registered globally via `APP_GUARD` — every route requires a valid Bearer token by default. Use `@Public()` to opt out.

**`@CurrentUser()`** injects an `AuthContext` object (not the raw Prisma `User`):
```ts
interface AuthContext {
  userId: string;
  profileId: string;
  accountId: string;
  roles: string[];      // e.g. ['OWNER', 'DOCTOR']
  branchIds: string[];  // branch IDs the profile belongs to
}
```
The JWT strategy (`jwt.strategy.ts`) rejects tokens with `type !== 'access'` and calls `AuthorizationService.getProfileContext()` to populate this context on every authenticated request.

**Authorization:** `AuthorizationService` (in `common/authorization/`) provides:
- `assertCanManageAccount(profileId, accountId)` — throws if not OWNER
- `assertCanManageBranch(profileId, accountId, branchId)` — throws if not OWNER or not in branch
- `assertCanManageStaff(profileId, accountId)` — throws if not OWNER
- `canManage*` / `canAccess*` — boolean equivalents

**Signup flow (3 steps):**
1. `POST /auth/signup/start` → creates `User`, sends OTP, returns `signup_token`
2. `POST /auth/signup/verify` → validates OTP, marks `verified_at`, returns fresh `signup_token`
3. `POST /auth/signup/complete` → creates `Account`, main `Branch`, `Profile` (with roles + branch), free-trial `Subscription`, marks `onboarding_completed`, returns `ProfileSelectionResponse`

Supported roles at signup: `OWNER` (required) and `DOCTOR` (optional). OWNER+DOCTOR means `is_clinical=true` and `specialty`/`job_title` are captured.

**Login / profile-selection flow:**
- `POST /auth/login` (email+password) or `POST /auth/phone/request-otp` → `POST /auth/phone/verify-otp`
- Both return either:
  - `{ type: 'profile_selection', selection_token, profiles[] }` — user has multiple profiles to choose from
  - `{ type: 'ONBOARDING_REQUIRED', step: 'VERIFY_OTP' | 'COMPLETE_ONBOARDING' }` — incomplete registration
- `POST /auth/profiles/select` — exchange `selection_token` + `profile_id` → `{ type: 'tokens', access_token, refresh_token, ... }`

JWT tokens carry `{ userId, profileId, accountId, type }`. Refresh tokens use JTI rotation (each refresh revokes the old token and stores a bcrypt hash).

**OTP:** 15-minute TTL, max 5 attempts. Resend cooldown: 60 seconds, max 5 resends per hour. `RegistrationCleanupService` purges PENDING users older than 24 hours (runs hourly via cron).

**Password reset:** `POST /auth/forgot-password` → `POST /auth/verify-reset-code` → `POST /auth/reset-password`.

**Versioning:** URI-based (`/v1/...`). Default version from `API_DEFAULT_VERSION` env var.

**Logging:** Pino — pretty-print in dev, JSON in production. Request ID propagated via `x-request-id` header.

**Locale:** `Accept-Language` header is parsed on each request and set as `x-locale`. Supported locales configured via `SUPPORTED_LOCALES` env var.

**ESLint rules enforced as errors:** `no-explicit-any`, `no-floating-promises`, `no-unsafe-argument`, `no-unused-vars` (allow `_` prefix), `no-misused-promises`. Run `npm run lint` before committing.

### Adding a new module

1. Create `src/modules/<feature>/` with controller, service, and module files.
2. Import the module in `AppModule`.
3. Inject `PrismaService` directly (globally provided).
4. Use `@CurrentUser() user: AuthContext` to access the authenticated identity; inject `AuthorizationService` for role/branch checks.
5. Use `paginated(items, { page, limit, total })` for list endpoints; return plain objects for single-resource endpoints.
6. Decorate controller methods with the appropriate `@ApiStandardResponse` / `@ApiPaginatedResponse` / `@ApiVoidResponse`.
7. Add Prisma models to `prisma/schema.prisma` and run `npx prisma migrate dev`.

### Data models (prisma/schema.prisma)

Core entities and their relationships:

- **Account** → many **Branch**, many **Profile**, many **Subscription**, many **Invitation**, many **JoinCode**
- **SubscriptionPlan** → many **Subscription**
- **Branch** → many **ProfileBranch**, many **InvitationBranch**, many **JoinCodeBranch** (unique: `id + account_id`)
- **User** → many **Profile**, many **RefreshToken**, many **VerificationCode**
- **Role** → many **ProfileRole**, many **InvitationRole**, many **JoinCodeRole**
- **Profile** — join of `User × Account`; unique `(user_id, account_id)` — carries `is_clinical`, `specialty`, `job_title`
- **ProfileRole** — M2M: `Profile × Role`; unique `(profile_id, role_id)`
- **ProfileBranch** — M2M: `Profile × Branch`; unique `(profile_id, branch_id)`
- **Invitation** — `Account` sends email invitations with pre-assigned roles/branches
- **JoinCode** — reusable (up to `max_uses`) codes with pre-assigned roles/branches
- **RefreshToken** — stores `jti` (UUID, unique), `token_hash` (bcrypt), `profile_id`, `account_id`, `expires_at`, `is_revoked`
- **VerificationCode** — stores `code_hash` (bcrypt), `expires_at`, `consumed_at` (null = unused), `attempts`, `purpose` (SIGNUP | LOGIN | PHONE_LOGIN | PASSWORD_RESET)

All models have UUID primary keys, `created_at`/`updated_at` timestamps, and soft-delete fields (`is_deleted`, `deleted_at`). `SubscriptionPlan` and `Role` are seed-only lookup tables — the app expects `OWNER` and `DOCTOR` roles and a `free_trial` plan to exist at runtime.

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
| `JWT_ACCESS_EXPIRATION`              | e.g. `15m` (default)                           |
| `JWT_REFRESH_EXPIRATION`             | e.g. `7d` (default)                            |
| `JWT_REGISTRATION_EXPIRATION`        | e.g. `30m` (default)                           |
| `RESEND_API_KEY`                     | Resend API key for transactional email          |
| `RESEND_FROM_EMAIL`                  | Sender address (default `noreply@example.com`)  |
| `FREE_TRIAL_DAYS`                    | Days before free-trial subscription expires (default `14`) |

`ConfigModule` loads `.env.{NODE_ENV}` then `.env`, so create `.env.test` to override vars in tests.

Always load:
.agents/skills/prisma-cli/SKILL.md
.agents/skills/git-workflow/SKILL.md
