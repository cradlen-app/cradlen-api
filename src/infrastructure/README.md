# `infrastructure/`

Adapters that wrap external technology behind small, swappable interfaces. The rest of the codebase depends on these abstractions, never on vendor SDKs directly.

## Dependency rule

`infrastructure → common only.` It must never import from `core`, `builder`, or `plugins`. Enforced by `eslint.config.mjs` (`import/no-restricted-paths`).

## Subfolders

- `database/` — Prisma client (`PrismaService`, `DatabaseModule`).
- `messaging/` — `EventBus` facade over NestJS `EventEmitter2`; `realtime/` Socket.IO gateways subscribe to events here.
- `email/` — Resend wrapper (`EmailService`, `EmailModule`).
- `logging/` — Pino logger.
- `monitoring/` — Sentry initialisation (`sentry.ts`, preloaded as the first import in `main.ts`).
- `cache/` — stub. Will host the Redis client when a consumer arrives.
- `queue/` — stub. Will host BullMQ wrappers when a consumer arrives.
- `sms/` — stub. Will host the SMS provider wrapper for reminders.
- `storage/` — stub. Will host the S3/R2 wrapper for attachments, scans, prescriptions.

## Conventions

- Each adapter exposes a `*.module.ts` and one or more interfaces in the same folder.
- Vendor SDK imports are confined to a single file per adapter.
- Stub folders contain only an interface + README until a consumer arrives.
