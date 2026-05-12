# `infrastructure/cache/`

Reserved for a Redis client and cache decorators. Not implemented — no consumer yet.

When the first consumer arrives, expose a `CacheService` interface here and add the concrete provider in this folder. The `CacheModule` should be `@Global()`.
