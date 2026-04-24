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
├── app.module.ts          # Root — imports all feature modules
├── main.ts                # Bootstrap: Helmet, CORS, versioning, Swagger, pipes, locale
├── common/                # Shared infrastructure (never holds business logic)
│   ├── constant/          # App constants and error codes
│   ├── dto/               # ApiResponse interfaces, PaginatedPayload types
│   ├── filters/           # GlobalExceptionFilter (maps Prisma errors → HTTP)
│   ├── interceptor/       # ResponseInterceptor, LoggingInterceptor
│   ├── logger/            # Pino logger factory
│   ├── middleware/        # RequestIdMiddleware (UUID per request)
│   ├── swagger/           # ApiStandardResponse, ApiPaginatedResponse, ApiVoidResponse decorators
│   └── utils/             # paginated() helper for list endpoints
├── config/
│   ├── app.config.ts      # PORT, CORS, throttle, locale, versioning
│   └── database.config.ts # DATABASE_URL
├── database/
│   ├── database.module.ts # Global module — exports PrismaService everywhere
│   └── prisma.service.ts  # PrismaClient with Neon adapter; exposes .db property
└── modules/
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
- **User** → one **Profile**, many **Staff** records
- **Role** → many **Staff**
- **Staff** unique constraint: `(user_id, organization_id, branch_id, role_id)`

All models have UUID primary keys, `created_at`/`updated_at` timestamps, and soft-delete fields (`is_deleted`, `deleted_at`).

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

Always load:
.agents/skills/prisma-cli/SKILL.md
.agents/skills/git-workflow/SKILL.md
