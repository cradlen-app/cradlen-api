import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Wraps an interactive-transaction client so it can stand in for the full
 * `PrismaClient` during an RLS request. A Prisma tx client has no `$transaction`
 * method, but existing services call `db.$transaction(...)` freely — under RLS
 * the whole request already runs inside one transaction, so nested calls must
 * *flatten* into it rather than open a new (connection-losing) transaction:
 *
 *  - callback form  → invoked with this same proxy (one transaction);
 *  - array form     → the batched promises are awaited in order on this tx.
 *
 * Everything else delegates to the underlying tx client. Cast to PrismaClient
 * for callers; the missing lifecycle methods ($connect/$extends/…) are never
 * called mid-request.
 */
export function createRlsTxProxy(tx: Prisma.TransactionClient): PrismaClient {
  const proxy: PrismaClient = new Proxy(tx as object, {
    get(target, prop) {
      if (prop === '$transaction') {
        return (arg: unknown) => {
          if (typeof arg === 'function') {
            return (arg as (t: unknown) => unknown)(proxy);
          }
          if (Array.isArray(arg)) {
            return (async () => {
              const results: unknown[] = [];
              for (const p of arg as unknown[]) results.push(await p);
              return results;
            })();
          }
          throw new Error('RLS: unsupported $transaction argument');
        };
      }
      return Reflect.get(target, prop) as unknown;
    },
  }) as unknown as PrismaClient;
  return proxy;
}
