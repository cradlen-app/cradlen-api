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
│   ├── constant/          # App constants and error codes
│   ├── decorators/        # @Public() (skip auth), @CurrentUser() (inject User from request)
│   ├── dto/               # ApiResponse interfaces, PaginatedPayload types
│   ├── filters/           # GlobalExceptionFilter (maps Prisma errors → HTTP)
│   ├── guards/            # JwtAuthGuard — applied globally via APP_GUARD
│   ├── interceptor/       # ResponseInterceptor, LoggingInterceptor
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
    ├── auth/              # JWT auth: 3-step registration, login, refresh, logout, /me
    ├── mail/              # Resend-backed email (OTP verification emails)
    └── health/            # DB connectivity check (reference module)
```

### Key conventions

**Response shape:** All responses wrapped by `ResponseInterceptor` → `{ data: T, meta: {} }`. For paginated responses return `paginated(items, { page, limit, total })` from `common/utils/pagination.utils.ts` — the interceptor detects the `items` + `meta` shape and restructures it to `{ data: items[], meta: { page, limit, total, totalPages } }`.

**Error shape:** `GlobalExceptionFilter` returns `{ error: { code, message, statusCode, details, requestId } }`. Prisma error mappings: P2002 → 409, P2025 → 404, P2003 → 400. Validation errors include per-field `details`.

**Database access:** Inject `PrismaService` and use `this.prismaService.db.<model>.<method>()`. `PrismaService` is globally provided — no need to import `DatabaseModule` in feature modules.

**Soft deletes:** Models use `is_deleted Boolean @default(false)` + `deleted_at DateTime?`. Always filter `where: { is_deleted: false }` in queries unless fetching deleted records intentionally.

**Swagger decorators** (from `common/swagger`):

- `@ApiStandardResponse(DtoClass)` — single resource endpoints
- `@ApiPaginatedResponse(DtoClass)` — list endpoints
- `@ApiVoidResponse()` — 204 No Content endpoints

**Authentication:** `JwtAuthGuard` is registered globally via `APP_GUARD` — every route requires a valid Bearer token by default. Use `@Public()` to opt out. Use `@CurrentUser()` to inject the full `User` Prisma record. The JWT strategy rejects tokens with `type: 'registration'` so registration tokens cannot call protected endpoints.

**Registration flow (3 steps):**
1. `POST /auth/register/personal` → creates `User` + `Profile`, sends OTP, returns `registration_token`
2. `POST /auth/register/verify-email` → validates OTP, marks `verified_at`, returns fresh `registration_token`
3. `POST /auth/register/organization` → creates `Organization`, main `Branch`, `Staff` (owner role), free-trial `Subscription`, returns access + refresh tokens

OTP resend: 60-second cooldown, max 5 attempts per 30-minute window. Refresh tokens use JTI rotation (each refresh revokes the old token).

**Versioning:** URI-based (`/v1/...`). Default version from `API_DEFAULT_VERSION` env var.

**Logging:** Pino — pretty-print in dev, JSON in production. Request ID propagated via `x-request-id` header.

**Locale:** `Accept-Language` header is parsed on each request and set as `x-locale`. Supported locales configured via `SUPPORTED_LOCALES` env var.

**ESLint rules enforced as errors:** `no-explicit-any`, `no-floating-promises`, `no-unsafe-argument`, `no-unused-vars` (allow `_` prefix), `no-misused-promises`. Run `npm run lint` before committing.

### Adding a new module

1. Create `src/modules/<feature>/` with controller, service, and module files.
2. Import the module in `AppModule`.
3. Inject `PrismaService` directly (globally provided).
4. Use `paginated(items, { page, limit, total })` for list endpoints; return plain objects for single-resource endpoints.
5. Decorate controller methods with the appropriate `@ApiStandardResponse` / `@ApiPaginatedResponse` / `@ApiVoidResponse`.
6. Add Prisma models to `prisma/schema.prisma` and run `npx prisma migrate dev`.

### Data models (prisma/schema.prisma)

Core entities and their relationships:

- **Organization** → many **Branch**, many **Staff**, many **Subscription**
- **SubscriptionPlan** → many **Subscription**
- **Branch** → many **Staff** (unique constraint: `id + organization_id`)
- **User** → one **Profile**, many **Staff** records, many **RefreshToken**, many **EmailVerification**
- **Role** → many **Staff**
- **Staff** unique constraint: `(user_id, organization_id, branch_id, role_id)`
- **RefreshToken** — stores `jti` (UUID, unique), `token_hash` (bcrypt), `expires_at`, `is_revoked`
- **EmailVerification** — stores `code_hash` (bcrypt), `expires_at`, `used_at` (null = unused)

All models have UUID primary keys, `created_at`/`updated_at` timestamps, and soft-delete fields (`is_deleted`, `deleted_at`). `SubscriptionPlan` and `Role` are seed-only lookup tables — the app expects `owner` role and `free_trial` plan to exist at runtime.

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
