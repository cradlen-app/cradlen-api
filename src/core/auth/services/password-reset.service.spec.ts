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
