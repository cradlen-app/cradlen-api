# Sentry Integration Design

**Date:** 2026-05-02  
**Status:** Approved

## Context

The API currently runs on Railway and relies solely on Railway's log tailing for observability. There is no error alerting, no error grouping/deduplication, and no performance tracing. Sentry replaces this gap by adding structured error monitoring, HTTP + database performance tracing, and full log forwarding — all visible in the Sentry dashboard without changing the Railway setup.

Pino continues logging to stdout (Railway) unchanged. Sentry runs as a parallel observability layer.

---

## Goals

- Error grouping and deduplication (Sentry Issues tab)
- HTTP endpoint performance tracing with latency per route
- Prisma query spans nested under HTTP transactions
- CPU profiling on sampled transactions
- All Pino logs forwarded to Sentry Logs tab (info, warn, error, debug, fatal)
- 500-level exceptions captured with full stack trace + request context
- 4xx errors excluded from Sentry issues (expected client errors)

---

## Packages

```bash
npm install @sentry/nestjs @sentry/profiling-node --save
```

`@prisma/instrumentation` is already a transitive dependency of Prisma — no extra install needed.

---

## Architecture

```
main.ts
  └── import './instrument'  ← must be first import

instrument.ts (new)
  └── Sentry.init()
        ├── nodeProfilingIntegration()
        └── PrismaInstrumentation()

AppModule
  └── SentryModule.forRoot()

GlobalExceptionFilter (modified)
  └── Sentry.captureException() for status >= 500 and non-HTTP exceptions

logger.ts (modified)
  └── pino multistream
        ├── Stream 1: stdout (Railway) — pino-pretty in dev, JSON in prod
        └── Stream 2: SentryWritable — maps Pino levels → Sentry.logger.*
```

---

## Component Details

### `src/instrument.ts` (new)

Must be imported before all other imports in `main.ts`.

```ts
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { PrismaInstrumentation } from '@prisma/instrumentation';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  enableLogs: true,
  sendDefaultPii: true,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  profileSessionSampleRate: 1.0,
  profileLifecycle: 'trace',
  integrations: [
    nodeProfilingIntegration(),
    new PrismaInstrumentation(),
  ],
});
```

- `tracesSampleRate` 0.2 in production (20%) to avoid quota burn; 1.0 in dev/staging
- `profileSessionSampleRate: 1.0` + `profileLifecycle: 'trace'` = CPU profiling on all sampled transactions
- `enableLogs: true` unlocks the Sentry Logs tab
- `sendDefaultPii: true` captures IP addresses and user agents on events

### `src/main.ts` (modified)

Add as the very first line, before all other imports:

```ts
import './instrument';
```

### `src/common/logger/logger.ts` (modified)

Replace the single-stream Pino logger with a multistream that fans out to both stdout and Sentry.

Pino uses numeric levels: `10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal`.

The `SentryWritable` stream:
- Parses each JSON log line emitted by Pino
- Maps the numeric level to the matching `Sentry.logger.*` method
- Forwards the `msg` string and all structured fields (requestId, method, url, etc.) as attributes
- In dev mode, `pino-pretty` remains on the stdout stream; Sentry stream runs in parallel

### `src/common/filters/global-exception.filter.ts` (modified)

Add Sentry capture inside the existing `catch(exception)` handler, before the response is built:

```ts
if (!(exception instanceof HttpException) || exception.getStatus() >= 500) {
  Sentry.captureException(exception);
}
```

This excludes 4xx responses (expected client errors) and only captures real server-side bugs.

### `src/app.module.ts` (modified)

```ts
import { SentryModule } from '@sentry/nestjs/setup';

@Module({
  imports: [SentryModule.forRoot(), ...],
})
```

`SentryModule` wires up the `SentryGlobalFilter` which manages the NestJS transaction lifecycle.

---

## What Gets Sent to Sentry

| Scenario | Sent? | Where |
|---|---|---|
| Unhandled exception (500) | ✅ | Issues tab + stack trace |
| Prisma unknown error | ✅ | Issues tab + stack trace |
| `HttpException` status < 500 | ❌ | Excluded — expected client errors |
| Prisma P2002 / P2025 / P2003 | ❌ | Excluded — mapped to 4xx |
| Every HTTP request (sampled) | ✅ | Performance tab — transaction |
| Every Prisma query | ✅ | Performance tab — child span |
| All Pino log lines | ✅ | Logs tab |

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `SENTRY_DSN` | DSN from Sentry project settings |

Add to `.env.example` and Railway config. Do not hardcode.

---

## Files Modified

| File | Change |
|---|---|
| `src/instrument.ts` | New — Sentry.init() bootstrap |
| `src/main.ts` | Add `import './instrument'` as first line |
| `src/common/logger/logger.ts` | Multistream: stdout + SentryWritable |
| `src/common/filters/global-exception.filter.ts` | Add Sentry.captureException for 500s |
| `src/app.module.ts` | Add SentryModule.forRoot() |
| `.env.example` | Add SENTRY_DSN |

---

## Verification Steps

1. Create a Node.js project in Sentry dashboard → copy DSN → add to `.env` as `SENTRY_DSN`
2. Run `npm run start:dev` — hit any endpoint — confirm a transaction appears in Sentry Performance tab within ~30 seconds
3. Trigger a deliberate 500 (throw an unhandled error in a service) — confirm it appears in Sentry Issues with stack trace and request context
4. Hit an endpoint that queries the DB — confirm Prisma spans appear nested under the HTTP transaction
5. Check Sentry Logs tab — confirm structured log entries appear with requestId, method, url fields
6. Tail Railway logs — confirm Pino stdout output is unchanged
7. Confirm 4xx errors (e.g. 401 from JWT guard) do NOT appear in Sentry Issues
