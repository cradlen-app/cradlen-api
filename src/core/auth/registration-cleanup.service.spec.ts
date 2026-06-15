import { RegistrationCleanupService } from './registration-cleanup.service.js';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';

function buildService(prismaOverrides: Record<string, unknown> = {}) {
  const prismaService = {
    db: {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      refreshToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      ...prismaOverrides,
    },
  } as unknown as PrismaService;
  return {
    service: new RegistrationCleanupService(prismaService),
    prismaService,
  };
}

describe('RegistrationCleanupService.cleanupExpiredRefreshTokens', () => {
  it('deletes both expired and revoked rows that fall outside the grace window', async () => {
    const before = Date.now();
    const refreshTokenDeleteMany = jest.fn().mockResolvedValue({ count: 7 });
    const { service } = buildService({
      refreshToken: { deleteMany: refreshTokenDeleteMany },
    });

    await service.cleanupExpiredRefreshTokens();

    expect(refreshTokenDeleteMany).toHaveBeenCalledTimes(1);
    const call = refreshTokenDeleteMany.mock.calls[0][0];
    expect(call.where.OR).toHaveLength(2);
    const [expiredClause, revokedClause] = call.where.OR;
    expect(expiredClause).toMatchObject({
      expires_at: { lt: expect.any(Date) },
    });
    expect(revokedClause).toMatchObject({
      is_revoked: true,
      revoked_at: { lt: expect.any(Date) },
    });
    // Grace cutoff sits roughly 30 days back.
    const graceMs = 30 * 24 * 60 * 60 * 1000;
    const expiredCutoff = (expiredClause.expires_at.lt as Date).getTime();
    const revokedCutoff = (revokedClause.revoked_at.lt as Date).getTime();
    expect(before - graceMs - 5000).toBeLessThanOrEqual(expiredCutoff);
    expect(expiredCutoff).toBeLessThanOrEqual(Date.now() - graceMs + 5000);
    expect(expiredCutoff).toBe(revokedCutoff);
  });

  it('swallows errors and logs without throwing so the cron survives a bad run', async () => {
    const refreshTokenDeleteMany = jest
      .fn()
      .mockRejectedValue(new Error('db down'));
    const { service } = buildService({
      refreshToken: { deleteMany: refreshTokenDeleteMany },
    });

    await expect(
      service.cleanupExpiredRefreshTokens(),
    ).resolves.toBeUndefined();
  });
});

describe('RegistrationCleanupService.cleanupExpiredPasswordResetTokens', () => {
  it('deletes expired and consumed rows', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 3 });
    const { service } = buildService({
      passwordResetToken: { deleteMany },
    });

    await service.cleanupExpiredPasswordResetTokens();

    expect(deleteMany).toHaveBeenCalledTimes(1);
    const call = deleteMany.mock.calls[0][0];
    expect(call.where.OR).toHaveLength(2);
    expect(call.where.OR[0]).toMatchObject({
      expires_at: { lt: expect.any(Date) },
    });
    expect(call.where.OR[1]).toMatchObject({
      consumed_at: { not: null },
    });
  });

  it('swallows errors and resolves so the cron survives a bad run', async () => {
    const deleteMany = jest.fn().mockRejectedValue(new Error('db down'));
    const { service } = buildService({
      passwordResetToken: { deleteMany },
    });

    await expect(
      service.cleanupExpiredPasswordResetTokens(),
    ).resolves.toBeUndefined();
  });
});

describe('RegistrationCleanupService.cleanupStalePendingUsers', () => {
  it('hard-deletes PENDING users older than the 24h cutoff', async () => {
    const before = Date.now();
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }]);
    const deleteMany = jest.fn().mockResolvedValue({ count: 2 });
    const { service } = buildService({ user: { findMany, deleteMany } });

    await service.cleanupStalePendingUsers();

    // Only PENDING users created before the cutoff are scanned.
    const findArgs = findMany.mock.calls[0][0];
    expect(findArgs.where.registration_status).toBe('PENDING');
    const cutoff = (findArgs.where.created_at.lt as Date).getTime();
    const ttlMs = 24 * 60 * 60 * 1000;
    expect(before - ttlMs - 5000).toBeLessThanOrEqual(cutoff);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - ttlMs + 5000);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['u1', 'u2'] } },
    });
  });

  it('does not delete anything when no stale users are found', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const { service } = buildService({ user: { findMany, deleteMany } });

    await service.cleanupStalePendingUsers();

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('drains in batches: keeps fetching while a full batch (500) comes back', async () => {
    const fullBatch = Array.from({ length: 500 }, (_, i) => ({ id: `u${i}` }));
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(fullBatch) // full → loop again
      .mockResolvedValueOnce([{ id: 'tail' }]); // partial → stop
    const deleteMany = jest.fn().mockResolvedValue({ count: 500 });
    const { service } = buildService({ user: { findMany, deleteMany } });

    await service.cleanupStalePendingUsers();

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(deleteMany).toHaveBeenCalledTimes(2);
  });

  it('swallows errors and resolves so the hourly cron survives a bad run', async () => {
    const findMany = jest.fn().mockRejectedValue(new Error('db down'));
    const { service } = buildService({
      user: { findMany, deleteMany: jest.fn() },
    });

    await expect(service.cleanupStalePendingUsers()).resolves.toBeUndefined();
  });
});
