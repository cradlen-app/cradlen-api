import type { Prisma } from '@prisma/client';
import { createRlsTxProxy } from './rls-tx-proxy.js';

describe('createRlsTxProxy', () => {
  it('delegates model access to the underlying tx client', () => {
    const patient = { findMany: () => 'rows' };
    const tx = { patient } as unknown as Prisma.TransactionClient;
    const proxy = createRlsTxProxy(tx);
    expect((proxy as unknown as { patient: typeof patient }).patient).toBe(
      patient,
    );
  });

  it('flattens the callback form of $transaction onto the same tx', async () => {
    const tx = { marker: 'M' } as unknown as Prisma.TransactionClient;
    const proxy = createRlsTxProxy(tx);
    const result = await proxy.$transaction((t) =>
      Promise.resolve((t as unknown as { marker: string }).marker),
    );
    expect(result).toBe('M');
  });

  it('runs the array form sequentially and returns results in order', async () => {
    const tx = {} as unknown as Prisma.TransactionClient;
    const proxy = createRlsTxProxy(tx);
    const result = await proxy.$transaction([
      Promise.resolve('a'),
      Promise.resolve('b'),
    ] as unknown as Parameters<typeof proxy.$transaction>[0]);
    expect(result).toEqual(['a', 'b']);
  });
});
