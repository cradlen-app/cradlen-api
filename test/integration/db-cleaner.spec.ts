import { cleanDatabase } from '../helpers/db-cleaner';

/**
 * Regression guard for the cleanDatabase retry loop.
 *
 * `$executeRawUnsafe` failures are wrapped by Prisma as a
 * `PrismaClientKnownRequestError` whose top-level `code` is the generic
 * `"P2010"` ("Raw query failed") — the real Postgres SQLSTATE (e.g. `40P01`
 * deadlock detected) is only present in the message string, NOT in `error.code`
 * or `error.meta.code`. A retry guard that inspects `error.code` therefore never
 * matches the lock SQLSTATEs and rethrows on the first attempt, defeating the
 * whole bounded-retry mechanism. These tests pin the message-based detection.
 */

/** Mirror Prisma's P2010 wrapping of a raw-query driver-adapter error. */
function rawQueryError(sqlstate: string): Error {
  return Object.assign(
    new Error(
      'Invalid `prisma.$executeRawUnsafe()` invocation:\n\n' +
        `Raw query failed. Code: \`${sqlstate}\`. Message: \`lock error\``,
    ),
    {
      name: 'PrismaClientKnownRequestError',
      code: 'P2010',
      meta: { driverAdapterError: {} },
    },
  );
}

/**
 * Build a fake Prisma client whose `$transaction` rejects with `error` for the
 * first `failures` attempts, then resolves. `$executeRawUnsafe` only assembles
 * the statement list; `$transaction` decides success/failure (mirrors the real
 * cleanDatabase call shape).
 */
function fakeClient(error: Error, failures: number) {
  let attempts = 0;
  const $transaction = jest.fn(() => {
    attempts += 1;
    if (attempts <= failures) return Promise.reject(error);
    return Promise.resolve([]);
  });
  return {
    client: {
      $executeRawUnsafe: jest.fn(() => ({}) as never),
      $transaction,
    } as never,
    $transaction,
  };
}

describe('cleanDatabase retry loop', () => {
  it('retries a 40P01 deadlock (surfaced as Prisma P2010) and then succeeds', async () => {
    const { client, $transaction } = fakeClient(rawQueryError('40P01'), 1);

    await expect(cleanDatabase(client)).resolves.toBeUndefined();
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it('retries a 55P03 lock-not-available error', async () => {
    const { client, $transaction } = fakeClient(rawQueryError('55P03'), 2);

    await expect(cleanDatabase(client)).resolves.toBeUndefined();
    expect($transaction).toHaveBeenCalledTimes(3);
  });

  it('rethrows a non-lock error immediately without retrying', async () => {
    // 23505 = unique_violation — a real failure that must NOT be masked.
    const { client, $transaction } = fakeClient(rawQueryError('23505'), 1);

    await expect(cleanDatabase(client)).rejects.toMatchObject({
      code: 'P2010',
    });
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});
