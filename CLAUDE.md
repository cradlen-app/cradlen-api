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

# Code quality
npm run lint            # ESLint with auto-fix
npm run format          # Prettier formatting

# Single test file
npx jest src/modules/health/health.service.spec.ts

# Database migrations (Prisma)
npx prisma migrate dev --name <migration-name>
npx prisma generate
```

## Architecture

**Stack:** NestJS + Prisma + Neon (serverless PostgreSQL)

### Module structure

```
src/
├── app.module.ts          # Root — imports all feature modules
├── main.ts                # Bootstrap: Helmet, CORS, versioning, Swagger, pipes
├── common/                # Shared infrastructure (never holds business logic)
│   ├── constant/          # App constants and error codes
│   ├── dto/               # ApiResponseDto, PaginatedResponseDto
│   ├── filters/           # GlobalExceptionFilter (maps Prisma errors → HTTP)
│   ├── interceptor/       # ResponseInterceptor (wraps all responses in {data, meta})
│   ├── logger/            # Pino-based structured logger
│   ├── middleware/         # RequestIdMiddleware
│   └── swagger/           # Swagger decorators and response DTOs
├── config/
│   ├── app.config.ts      # App-level env vars (PORT, CORS, throttle, locale, etc.)
│   └── database.config.ts # DATABASE_URL / DIRECT_URL
├── database/
│   ├── database.module.ts # Global module — exports PrismaService everywhere
│   └── prisma.service.ts  # PrismaClient with Neon adapter; lifecycle hooks
└── modules/
    └── health/            # Only implemented feature module (DB connectivity check)
```

### Key conventions

- **Response shape:** All responses are wrapped by `ResponseInterceptor` → `{ data: T, meta: {} }`. Paginated responses get `meta: { total, page, limit, ... }` via `PaginatedResponseDto`.
- **Error shape:** `GlobalExceptionFilter` catches all exceptions and maps Prisma error codes (P2002 → 409, P2025 → 404, etc.) to HTTP responses with `{ error, errorCode, requestId }`.
- **Versioning:** URI-based (`/v1/...`). Default version is `API_DEFAULT_VERSION` from env.
- **Swagger:** Available at `/docs` in non-production environments; uses Bearer auth header (auth module not yet implemented).
- **Database:** `DATABASE_URL` uses Neon connection pooler; `DIRECT_URL` is the direct connection used by Prisma Migrate.
- **Logging:** Pino — pretty-print in dev, JSON in production. Request ID propagated through all log entries.

### Adding a new module

1. Create `src/modules/<feature>/` with controller, service, module files.
2. Import the module in `AppModule`.
3. Inject `PrismaService` directly (it is globally provided by `DatabaseModule`).
4. Use `PaginatedResponseDto` for list endpoints; return plain objects for single-resource endpoints.
5. Add Prisma models to `prisma/schema.prisma` and run `npx prisma migrate dev`.

## Environment variables

Copy `.env.example` to `.env`. Required vars:

| Variable                          | Purpose                                   |
| --------------------------------- | ----------------------------------------- |
| `DATABASE_URL`                    | Neon pooler connection string             |
| `DIRECT_URL`                      | Neon direct connection (migrations)       |
| `PORT`                            | HTTP port (default 3000)                  |
| `CORS_ORIGINS`                    | Comma-separated allowed origins           |
| `THROTTLE_TTL` / `THROTTLE_LIMIT` | Rate limiting window (ms) and request cap |
| `LOG_LEVEL`                       | `trace\|debug\|info\|warn\|error\|fatal`  |
| `SUPPORTED_LOCALES`               | e.g. `en,ar`                              |
