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
