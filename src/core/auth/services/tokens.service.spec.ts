import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokensService } from './tokens.service.js';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AUTH_EVENTS } from '../events/auth.events.js';

interface TxMocks {
  refreshTokenUpdateMany: jest.Mock;
  refreshTokenCreate: jest.Mock;
}

function buildService(txOverrides: Partial<TxMocks> = {}) {
  const profileFindFirst = jest.fn().mockResolvedValue({ id: 'profile-uuid' });
  const refreshTokenUpdateMany =
    txOverrides.refreshTokenUpdateMany ??
    jest.fn().mockResolvedValue({ count: 1 });
  const refreshTokenCreate =
    txOverrides.refreshTokenCreate ?? jest.fn().mockResolvedValue({});

  const $transaction = jest.fn(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        refreshToken: {
          updateMany: refreshTokenUpdateMany,
          create: refreshTokenCreate,
        },
      };
      return fn(tx);
    },
  );

  const prismaService = {
    db: {
      profile: { findFirst: profileFindFirst },
      $transaction,
    },
  } as unknown as PrismaService;

  const jwtService = new JwtService();
  const configService = {
    get: jest.fn().mockReturnValue({
      jwt: {
        accessSecret: 'access-secret',
        refreshSecret: 'refresh-secret',
        resetSecret: 'reset-secret',
        accessExpiration: '15m',
        refreshExpiration: '7d',
        registrationExpiration: '30m',
      },
    }),
  };

  const publish = jest.fn();
  const eventBus = { publish } as unknown as EventBus;

  const service = new TokensService(
    prismaService,
    jwtService,
    configService as never,
    eventBus,
  );

  return {
    service,
    refreshTokenUpdateMany,
    refreshTokenCreate,
    $transaction,
    publish,
  };
}

describe('TokensService.issueTokenPair atomic rotation', () => {
  const baseArgs = {
    user: { id: 'user-uuid' },
    profileId: 'profile-uuid',
    organizationId: 'org-uuid',
    activeBranchId: 'branch-uuid',
  };

  it('rotates refresh-token row atomically: revoke + create succeed or both fail', async () => {
    const {
      service,
      refreshTokenUpdateMany,
      refreshTokenCreate,
      $transaction,
      publish,
    } = buildService();

    const result = await service.issueTokenPair({
      ...baseArgs,
      revokeJti: 'prior-jti',
    });

    expect(result.type).toBe('tokens');
    expect(result.access_token).toEqual(expect.any(String));
    expect(result.refresh_token).toEqual(expect.any(String));
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(refreshTokenUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jti: 'prior-jti', is_revoked: false },
        data: expect.objectContaining({ is_revoked: true }),
      }),
    );
    expect(refreshTokenCreate).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      AUTH_EVENTS.refresh.rotated,
      expect.objectContaining({
        user_id: baseArgs.user.id,
        profile_id: baseArgs.profileId,
        organization_id: baseArgs.organizationId,
        old_jti: 'prior-jti',
        new_jti: expect.any(String),
        rotated_at: expect.any(Date),
      }),
    );
  });

  it('rejects a refresh-token rotation when the prior jti is already revoked', async () => {
    const refreshTokenCreate = jest.fn();
    const { service } = buildService({
      refreshTokenUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
      refreshTokenCreate,
    });

    await expect(
      service.issueTokenPair({ ...baseArgs, revokeJti: 'already-revoked' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(refreshTokenCreate).not.toHaveBeenCalled();
  });

  it('rejects two parallel rotations with the same prior jti — one wins', async () => {
    // Simulate Postgres: the first updateMany sees is_revoked=false and flips
    // it to true; the second sees the now-revoked row and matches zero.
    const refreshTokenUpdateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const refreshTokenCreate = jest.fn().mockResolvedValue({});

    const { service } = buildService({
      refreshTokenUpdateMany,
      refreshTokenCreate,
    });

    const results = await Promise.allSettled([
      service.issueTokenPair({ ...baseArgs, revokeJti: 'contested-jti' }),
      service.issueTokenPair({ ...baseArgs, revokeJti: 'contested-jti' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(UnauthorizedException);
    expect(refreshTokenCreate).toHaveBeenCalledTimes(1);
  });
});
