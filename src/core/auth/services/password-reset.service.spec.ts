import { HttpException } from '@nestjs/common';
import { createAuthTestEnv } from './test-env.js';

describe('PasswordResetService.start — enumeration symmetry (S-01)', () => {
  function decodeJwt(token: string): {
    userId: string;
    target: string;
    type: string;
    verified: boolean;
    exp?: number;
    iat?: number;
  } {
    const segments = token.split('.');
    expect(segments).toHaveLength(3);
    return JSON.parse(Buffer.from(segments[1], 'base64url').toString());
  }

  it('returns a structurally identical token regardless of whether the email is known', async () => {
    const knownEnv = createAuthTestEnv();
    knownEnv.mocks.userFindFirst.mockResolvedValue({
      id: 'user-1',
      email: 'sara@example.com',
    });
    knownEnv.mocks.verificationUpdateMany.mockResolvedValue({ count: 0 });
    knownEnv.mocks.verificationCreate.mockResolvedValue({});

    const known = await knownEnv.passwordResetService.start({
      email: 'sara@example.com',
    });

    const unknownEnv = createAuthTestEnv();
    unknownEnv.mocks.userFindFirst.mockResolvedValue(null);

    const unknown = await unknownEnv.passwordResetService.start({
      email: 'ghost@example.com',
    });

    // Response keys + types match exactly.
    expect(Object.keys(known).sort()).toEqual(['expires_in', 'reset_token']);
    expect(Object.keys(unknown).sort()).toEqual(['expires_in', 'reset_token']);
    expect(typeof known.reset_token).toBe('string');
    expect(typeof unknown.reset_token).toBe('string');
    expect(known.expires_in).toBe(unknown.expires_in);
    expect(known.expires_in).toBeGreaterThan(0);

    // JWT payload shape matches — same claim set, both verified=false,
    // both type=password_reset. Only userId and target differ as expected.
    const knownPayload = decodeJwt(known.reset_token);
    const unknownPayload = decodeJwt(unknown.reset_token);
    expect(Object.keys(knownPayload).sort()).toEqual(
      Object.keys(unknownPayload).sort(),
    );
    expect(knownPayload.type).toBe('password_reset');
    expect(unknownPayload.type).toBe('password_reset');
    expect(knownPayload.verified).toBe(false);
    expect(unknownPayload.verified).toBe(false);
    expect(unknownPayload.target).toBe('ghost@example.com');
    expect(unknownPayload.userId).toEqual(expect.any(String));
    expect(unknownPayload.userId).not.toBe('user-1');
  });

  it('does NOT send a verification email when the email is unknown', async () => {
    const { passwordResetService, mocks } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue(null);

    await passwordResetService.start({ email: 'ghost@example.com' });

    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled();
    expect(mocks.verificationCreate).not.toHaveBeenCalled();
  });

  it('subsequent verify-reset-code with the synthetic token rejects with INVALID_CODE (same as real wrong code)', async () => {
    const { passwordResetService, mocks } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue(null);
    // For the verify step, no verification row exists for the synthetic
    // userId, so the consume call short-circuits the same way it would
    // for an unconsumed-but-wrong-code on a real account.
    mocks.verificationFindFirst.mockResolvedValue(null);

    const { reset_token } = await passwordResetService.start({
      email: 'ghost@example.com',
    });

    await expect(
      passwordResetService.verify({ reset_token, code: '123456' }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

describe('PasswordResetService — reset-token reuse prevention (S-04)', () => {
  async function buildVerifiedToken(env: ReturnType<typeof createAuthTestEnv>) {
    env.mocks.userFindFirst.mockResolvedValue({
      id: 'user-1',
      email: 'sara@example.com',
    });
    const codeHash = await import('bcryptjs').then((b) => b.hash('123456', 10));
    env.mocks.verificationFindFirst.mockResolvedValue({
      id: 'vc-1',
      code_hash: codeHash,
      expires_at: new Date(Date.now() + 60_000),
      attempts: 0,
      max_attempts: 5,
    });
    (
      env.prismaService.db.verificationCode as unknown as { update: jest.Mock }
    ).update = jest.fn().mockResolvedValue({});

    const { reset_token } = await env.passwordResetService.start({
      email: 'sara@example.com',
    });

    const verified = await env.passwordResetService.verify({
      reset_token,
      code: '123456',
    });
    return verified.reset_token;
  }

  it('verify writes a PasswordResetToken row keyed by the new verified jti', async () => {
    const env = createAuthTestEnv();
    const passwordResetCreate = jest.fn().mockResolvedValue({});
    (
      env.prismaService.db.passwordResetToken as unknown as {
        create: jest.Mock;
      }
    ).create = passwordResetCreate;

    await buildVerifiedToken(env);

    expect(passwordResetCreate).toHaveBeenCalledTimes(1);
    expect(passwordResetCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jti: expect.any(String),
        user_id: 'user-1',
        target: 'sara@example.com',
        expires_at: expect.any(Date),
      }),
    });
  });

  it('reset succeeds when the row is unconsumed; the row gets marked consumed_at atomically with the password update', async () => {
    const env = createAuthTestEnv();
    const passwordResetUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const userUpdate = jest.fn().mockResolvedValue({});
    const refreshTokenUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    (
      env.prismaService.db as unknown as { $transaction: jest.Mock }
    ).$transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        passwordResetToken: { updateMany: passwordResetUpdateMany },
        user: { update: userUpdate },
        refreshToken: { updateMany: refreshTokenUpdateMany },
      }),
    );

    const verifiedToken = await buildVerifiedToken(env);

    await env.passwordResetService.reset({
      reset_token: verifiedToken,
      password: 'NewPassword1!',
      confirm_password: 'NewPassword1!',
    });

    expect(passwordResetUpdateMany).toHaveBeenCalledWith({
      where: { jti: expect.any(String), consumed_at: null },
      data: { consumed_at: expect.any(Date) },
    });
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(refreshTokenUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('reset rejects a re-used verified token (count = 0) and does NOT touch the password or refresh tokens', async () => {
    const env = createAuthTestEnv();
    const passwordResetUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const userUpdate = jest.fn();
    const refreshTokenUpdateMany = jest.fn();
    (
      env.prismaService.db as unknown as { $transaction: jest.Mock }
    ).$transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        passwordResetToken: { updateMany: passwordResetUpdateMany },
        user: { update: userUpdate },
        refreshToken: { updateMany: refreshTokenUpdateMany },
      }),
    );

    const verifiedToken = await buildVerifiedToken(env);

    await expect(
      env.passwordResetService.reset({
        reset_token: verifiedToken,
        password: 'NewPassword1!',
        confirm_password: 'NewPassword1!',
      }),
    ).rejects.toThrow('Reset token already used or expired');

    expect(userUpdate).not.toHaveBeenCalled();
    expect(refreshTokenUpdateMany).not.toHaveBeenCalled();
  });
});
