# Cradlen API

NestJS REST API for the Cradlen platform, backed by Neon serverless PostgreSQL.

## Stack

- **NestJS 11** · **Prisma 7** · **Neon** (serverless PostgreSQL)
- **Pino** structured logging · **Swagger** at `/docs` · URI versioning (`/v1/`)
- Helmet · CORS · Rate limiting (Throttler) · Bilingual support (en, ar)

## Quick Start

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL & DIRECT_URL
npx prisma generate
npm run start:dev         # → http://localhost:3000
                          # → Swagger UI: http://localhost:3000/docs
```

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Neon pooler connection string | — |
| `DIRECT_URL` | Neon direct connection (used by Prisma Migrate) | — |
| `PORT` | HTTP port | `3000` |
| `API_DEFAULT_VERSION` | URI version prefix | `1` |
| `CORS_ORIGINS` | Comma-separated allowed origins | `http://localhost:3000,...` |
| `JWT_RESET_SECRET` | Dedicated password-reset token secret | — |
| `THROTTLE_TTL` | Rate-limit window in milliseconds | `60000` |
| `THROTTLE_LIMIT` | Max requests per window | `100` |
| `LOG_LEVEL` | `trace\|debug\|info\|warn\|error\|fatal` | `info` |
| `DEFAULT_LOCALE` | Default locale | `en` |
| `SUPPORTED_LOCALES` | Comma-separated supported locales | `en,ar` |
| `FALLBACK_LOCALE` | Fallback locale | `en` |

## Commands

```bash
# Development
npm run start:dev       # Hot-reload dev server
npm run start:debug     # Debug mode with hot-reload
npm run build           # Compile with NestJS CLI
npm run start:prod      # Run compiled build

# Testing
npm run test            # Unit tests
npm run test:watch      # Watch mode
npm run test:cov        # Coverage report
npm run test:e2e        # End-to-end tests

# Code quality
npm run lint            # ESLint with auto-fix
npm run format          # Prettier formatting

# Database (Prisma)
npx prisma migrate dev --name <migration-name>
npx prisma generate
```

## Project Structure

```
src/
├── main.ts                 # Bootstrap: Helmet, CORS, versioning, Swagger, pipes
├── app.module.ts           # Root module — imports all feature modules
├── common/                 # Shared infrastructure (no business logic)
│   ├── constant/           # App constants and error codes
│   ├── decorators/
│   ├── dto/                # ApiResponseDto, PaginatedResponseDto
│   ├── filters/            # GlobalExceptionFilter (Prisma errors → HTTP)
│   ├── guards/
│   ├── interceptor/        # ResponseInterceptor, LoggingInterceptor
│   ├── logger/             # Pino-based structured logger
│   ├── middleware/         # RequestIdMiddleware
│   ├── pipes/
│   ├── swagger/            # Swagger decorators and response DTOs
│   └── utils/              # Pagination utilities
├── config/
│   ├── app.config.ts       # PORT, CORS, throttle, versioning, locale
│   └── database.config.ts  # DATABASE_URL / DIRECT_URL
├── database/
│   ├── database.module.ts  # Global module — exports PrismaService everywhere
│   └── prisma.service.ts   # PrismaClient with Neon adapter; lifecycle hooks
└── modules/
    └── health/             # Health check endpoint (DB connectivity)
```

## Architecture & Conventions

**Response shape** — All responses are wrapped by `ResponseInterceptor`:
```json
{ "data": { ... }, "meta": {} }
```
Paginated list responses include `meta: { total, page, limit, ... }` via `PaginatedResponseDto`.

**Error shape** — `GlobalExceptionFilter` maps exceptions to HTTP responses:
```json
{ "error": "...", "errorCode": "...", "requestId": "..." }
```
Prisma error codes are mapped automatically (e.g. P2002 → 409 Conflict, P2025 → 404 Not Found).

**Versioning** — URI-based. All routes are prefixed with `/v{API_DEFAULT_VERSION}/` (e.g. `/v1/health`).

**Token responses** — Auth token responses include a discriminator (`type: "tokens"`). Pending login responses include `type: "pending"` plus `pending_step`.

**Swagger** — Available at `/docs` in non-production environments. Uses Bearer auth header.

**Logging** — Pino: pretty-print in development, JSON in production. Request ID is propagated through all log entries.

## Adding a New Module

1. Create `src/modules/<feature>/` with `controller`, `service`, and `module` files.
2. Import the module in `AppModule`.
3. Inject `PrismaService` directly — it is globally provided by `DatabaseModule`.
4. Use `PaginatedResponseDto` for list endpoints; return plain objects for single-resource endpoints.
5. Add Prisma models to `prisma/schema.prisma` and run `npx prisma migrate dev`.

## License

UNLICENSED
