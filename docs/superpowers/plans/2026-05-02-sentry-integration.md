# Sentry Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Sentry into the NestJS API for error monitoring, HTTP + Prisma performance tracing, CPU profiling, and full Pino log forwarding — running alongside existing Railway stdout logging.

**Architecture:** `instrument.ts` bootstraps Sentry before any NestJS code; `logger.ts` fans out each Pino log line to both stdout and Sentry via multistream; `GlobalExceptionFilter` captures 500-level exceptions; `SentryModule` wires the NestJS transaction lifecycle.

**Tech Stack:** `@sentry/nestjs`, `@sentry/profiling-node`, `@prisma/instrumentation`, `pino`, `pino-pretty`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/instrument.ts` | Create | Sentry.init() — must load before all other modules |
| `src/main.ts` | Modify line 1 | Add `import './instrument'` as first import |
| `src/common/logger/logger.ts` | Modify | Multistream: stdout (pino-pretty in dev / JSON in prod) + Sentry Writable |
| `src/common/filters/global-exception.filter.ts` | Modify lines 103–113, 169–179 | Add Sentry.captureException for unknown Prisma errors and unhandled exceptions |
| `src/app.module.ts` | Modify | Register SentryModule.forRoot() |
| `.env.example` | Modify | Add SENTRY_DSN |

---

## Task 1: Install packages and add env var

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Install Sentry packages**

```bash
npm install @sentry/nestjs @sentry/profiling-node --save
```

Expected: packages added to `node_modules` and `package.json` dependencies.

- [ ] **Step 2: Add SENTRY_DSN to .env.example**

Append after the `# Invitations` section at the end of `.env.example`:

```env
# =============================================================================
# Sentry (Error Monitoring & Tracing)
# Get DSN from: Sentry dashboard → Project → Settings → Client Keys
# =============================================================================
SENTRY_DSN=https://<key>@<org>.ingest.de.sentry.io/<project-id>
```

- [ ] **Step 3: Add SENTRY_DSN to your local .env**

Copy the real DSN from your Sentry project (Settings → Client Keys → DSN) into your local `.env`:

```env
SENTRY_DSN=https://your-actual-dsn-here
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: install @sentry/nestjs and @sentry/profiling-node"
```

---

## Task 2: Create instrument.ts

**Files:**
- Create: `src/instrument.ts`

This file must be the very first import in `main.ts`. It calls `Sentry.init()` before NestJS bootstraps so that all auto-instrumentation hooks are in place.

- [ ] **Step 1: Create `src/instrument.ts`**

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

- [ ] **Step 2: Verify TypeScript accepts the file**

```bash
npx tsc --noEmit
```

Expected: no errors related to `instrument.ts`. If `@prisma/instrumentation` types are missing, run `npm install @prisma/instrumentation --save-dev`.

- [ ] **Step 3: Commit**

```bash
git add src/instrument.ts
git commit -m "feat(sentry): add instrument.ts with Sentry.init()"
```

---

## Task 3: Update main.ts — add instrument import

**Files:**
- Modify: `src/main.ts` (line 1)

The `import './instrument'` side-effect import must appear before all other imports so Sentry hooks are registered before NestJS loads any module.

- [ ] **Step 1: Add instrument import as the very first line of `src/main.ts`**

Replace the current first line:
```ts
import { NestFactory } from '@nestjs/core';
```

With:
```ts
import './instrument';
import { NestFactory } from '@nestjs/core';
```

The full top of `src/main.ts` should now look like:
```ts
import './instrument';
import { NestFactory } from '@nestjs/core';
import { VersioningType, ValidationPipe } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
// ... rest of imports unchanged
```

- [ ] **Step 2: Verify the app starts**

```bash
npm run start:dev
```

Expected: server starts on configured port, no Sentry initialization errors in the log. If `SENTRY_DSN` is missing you'll see a warning but not a crash.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(sentry): load instrument.ts before NestJS bootstrap"
```

---

## Task 4: Update logger.ts — multistream to stdout + Sentry

**Files:**
- Modify: `src/common/logger/logger.ts`

Replace the single-stream Pino logger with a multistream that writes every log line to both stdout and Sentry's log API. Pino emits numeric levels (`10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal`) as JSON — the `SentryWritable` stream parses each line and calls the matching `Sentry.logger.*` method.

In dev, `pino-pretty` is used as a sync Transform stream (not a worker-thread transport) so it can be combined with multistream.

- [ ] **Step 1: Rewrite `src/common/logger/logger.ts`**

```ts
import pino from 'pino';
import pretty from 'pino-pretty';
import * as Sentry from '@sentry/nestjs';
import { Writable } from 'stream';

const isDev = process.env.NODE_ENV !== 'production';

type SentryLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

function pinoLevelToSentry(level: number): SentryLevel {
  if (level >= 60) return 'fatal';
  if (level >= 50) return 'error';
  if (level >= 40) return 'warn';
  if (level >= 30) return 'info';
  if (level >= 20) return 'debug';
  return 'trace';
}

const sentryWritable = new Writable({
  write(chunk: Buffer, _encoding: string, callback: () => void) {
    try {
      const log = JSON.parse(chunk.toString()) as Record<string, unknown>;
      const { level, msg, pid: _pid, hostname: _hostname, time: _time, ...attrs } = log;
      Sentry.logger[pinoLevelToSentry(level as number)](String(msg), attrs);
    } catch {
      // ignore malformed lines (e.g. pino-pretty decorations)
    }
    callback();
  },
});

const stdoutStream = isDev
  ? pretty({ colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' })
  : process.stdout;

export const logger = pino(
  { level: process.env.LOG_LEVEL ?? 'info' },
  pino.multistream([
    { stream: stdoutStream },
    { stream: sentryWritable },
  ]),
);
```

- [ ] **Step 2: Verify TypeScript accepts the file**

```bash
npx tsc --noEmit
```

Expected: no type errors. If `pino-pretty` default import fails, check that `"esModuleInterop": true` is set in `tsconfig.json`. If needed, use `import * as pretty from 'pino-pretty'` and call `pretty.default({...})`.

- [ ] **Step 3: Start dev server and confirm both streams work**

```bash
npm run start:dev
```

Then in another terminal:
```bash
curl http://localhost:3000/v1/health
```

Expected:
- Terminal running the server shows colorized pino-pretty output (stdout still works)
- Sentry Logs tab (in Sentry dashboard) shows the `incoming request` and `request completed` log entries within ~30 seconds

- [ ] **Step 4: Commit**

```bash
git add src/common/logger/logger.ts
git commit -m "feat(sentry): multistream pino logs to stdout and Sentry"
```

---

## Task 5: Update GlobalExceptionFilter — capture 500-level errors

**Files:**
- Modify: `src/common/filters/global-exception.filter.ts`

Two locations need `Sentry.captureException()`:
1. **Lines 103–113** — unknown Prisma errors (the `else` branch of the Prisma error handler)
2. **Lines 169–179** — fully unhandled exceptions (the final `else` block)

4xx errors (P2002, P2025, P2003, BadRequestException, HttpException < 500) are intentionally excluded — they are expected client errors and should not pollute Sentry Issues.

- [ ] **Step 1: Add the Sentry import to the filter**

At the top of `src/common/filters/global-exception.filter.ts`, add after the existing imports:

```ts
import * as Sentry from '@sentry/nestjs';
```

The imports block should look like:
```ts
import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ERROR_CODES, type ErrorCode } from '../constant/error-codes.js';
import * as Sentry from '@sentry/nestjs';
```

- [ ] **Step 2: Add Sentry capture for unknown Prisma errors**

Find the `else` block starting at line 103 (after `} else if (code === 'P2003') {`):

```ts
      } else {
        this.logger.error(
          `Prisma error ${code} on ${request.method} ${request.url}`,
          exception.stack,
        );
        body = {
          code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          message: 'A database error occurred',
          statusCode: status,
          details: {},
        };
      }
```

Replace with:

```ts
      } else {
        this.logger.error(
          `Prisma error ${code} on ${request.method} ${request.url}`,
          exception.stack,
        );
        Sentry.captureException(exception);
        body = {
          code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          message: 'A database error occurred',
          statusCode: status,
          details: {},
        };
      }
```

- [ ] **Step 3: Add Sentry capture for unhandled exceptions**

Find the final `else` block starting at line 169:

```ts
    } else {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      body = {
        code: ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: 'An unexpected error occurred',
        statusCode: status,
        details: {},
      };
    }
```

Replace with:

```ts
    } else {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      Sentry.captureException(exception);
      body = {
        code: ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: 'An unexpected error occurred',
        statusCode: status,
        details: {},
      };
    }
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/common/filters/global-exception.filter.ts
git commit -m "feat(sentry): capture 500-level exceptions in GlobalExceptionFilter"
```

---

## Task 6: Register SentryModule in AppModule

**Files:**
- Modify: `src/app.module.ts`

`SentryModule.forRoot()` wires the `SentryGlobalFilter` into NestJS's DI container, which manages the HTTP transaction lifecycle (opening/closing Sentry performance spans per request).

- [ ] **Step 1: Add SentryModule import and registration**

Add the import at the top of `src/app.module.ts`:

```ts
import { SentryModule } from '@sentry/nestjs/setup';
```

Then add `SentryModule.forRoot()` as the **first entry** in the `imports` array (order matters — it must register before feature modules):

```ts
@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
      load: [appConfig, databaseConfig, authConfig],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const appConfig = config.get<AppConfig>('app');
        if (!appConfig) throw new Error('App configuration not loaded');
        const { ttl, limit } = appConfig.throttle;
        return [{ ttl, limit }];
      },
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    RolesModule,
    UsersModule,
    AccountsModule,
    ProfilesModule,
    BranchesModule,
    InvitationsModule,
    JoinCodesModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Verify TypeScript and start the server**

```bash
npx tsc --noEmit && npm run start:dev
```

Expected: server starts cleanly. No errors about missing Sentry setup.

- [ ] **Step 3: Commit**

```bash
git add src/app.module.ts
git commit -m "feat(sentry): register SentryModule in AppModule"
```

---

## Task 7: End-to-end verification

No code changes — confirm everything works in the Sentry dashboard.

- [ ] **Step 1: Verify HTTP performance transactions**

```bash
curl http://localhost:3000/v1/health
```

Go to Sentry → Performance tab. Within ~30 seconds you should see a transaction for `GET /v1/health` with duration and status.

- [ ] **Step 2: Verify Prisma query spans**

Hit an endpoint that reads from the database (e.g. `GET /v1/auth/me` with a valid token). In Sentry → Performance → click that transaction → confirm Prisma query spans appear nested under the HTTP transaction with their SQL and duration.

- [ ] **Step 3: Verify error capture**

Temporarily add a thrown error inside any service method:

```ts
throw new Error('sentry-test: manual trigger');
```

Hit that endpoint. Sentry → Issues tab should show a new issue with the full stack trace and request context (URL, method, IP). Remove the throw after confirming.

- [ ] **Step 4: Verify 4xx errors are excluded**

Hit a protected endpoint without a token:

```bash
curl http://localhost:3000/v1/auth/me
```

This should return a 401. Confirm no new issue appears in Sentry → Issues for this request.

- [ ] **Step 5: Verify Sentry Logs tab**

Sentry → Logs tab. Confirm `incoming request` and `request completed` entries appear with structured fields (`requestId`, `method`, `url`, `statusCode`, `durationMs`).

- [ ] **Step 6: Verify Railway stdout is unchanged**

The terminal running `npm run start:dev` should still show colorized pino-pretty output as before — Sentry stream is additive, not a replacement.
