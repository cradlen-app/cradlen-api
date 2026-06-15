import { HttpException, HttpStatus } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import { createAuthTestEnv } from './test-env.js';

describe('VerificationCodesService.consume', () => {
  const futureExpiry = () => new Date(Date.now() + 5 * 60 * 1000);

  it('increments attempts atomically on wrong code and rejects with INVALID_CODE', async () => {
    const { verificationCodesService, mocks, prismaService } =
      createAuthTestEnv();
    const code_hash = await bcrypt.hash('123456', 10);
    mocks.verificationFindFirst.mockResolvedValue({
      id: 'verification-row-id',
      code_hash,
      expires_at: futureExpiry(),
      attempts: 2,
      max_attempts: 5,
    });
    const verificationUpdate = jest.fn().mockResolvedValue({});
    prismaService.db.verificationCode.update = verificationUpdate;

    await expect(
      verificationCodesService.consume({
        userId: 'user-1',
        target: 'sara@example.com',
        purpose: 'SIGNUP',
        code: '999999',
      }),
    ).rejects.toMatchObject({
      response: { code: ERROR_CODES.INVALID_CODE },
      status: HttpStatus.BAD_REQUEST,
    });

    expect(verificationUpdate).toHaveBeenCalledTimes(1);
    expect(verificationUpdate).toHaveBeenCalledWith({
      where: { id: 'verification-row-id' },
      data: { attempts: { increment: 1 } },
    });
  });

  it('does NOT increment attempts when the code matches; marks consumed_at instead', async () => {
    const { verificationCodesService, mocks, prismaService } =
      createAuthTestEnv();
    const code_hash = await bcrypt.hash('123456', 10);
    mocks.verificationFindFirst.mockResolvedValue({
      id: 'verification-row-id',
      code_hash,
      expires_at: futureExpiry(),
      attempts: 0,
      max_attempts: 5,
    });
    const verificationUpdate = jest.fn().mockResolvedValue({});
    prismaService.db.verificationCode.update = verificationUpdate;

    await expect(
      verificationCodesService.consume({
        userId: 'user-1',
        target: 'sara@example.com',
        purpose: 'SIGNUP',
        code: '123456',
      }),
    ).resolves.toBeUndefined();

    expect(verificationUpdate).toHaveBeenCalledTimes(1);
    expect(verificationUpdate).toHaveBeenCalledWith({
      where: { id: 'verification-row-id' },
      data: { consumed_at: expect.any(Date) },
    });
  });

  it('rejects with MAX_ATTEMPTS_EXCEEDED before bcrypt check when attempts at max', async () => {
    const { verificationCodesService, mocks, prismaService } =
      createAuthTestEnv();
    const code_hash = await bcrypt.hash('123456', 10);
    mocks.verificationFindFirst.mockResolvedValue({
      id: 'verification-row-id',
      code_hash,
      expires_at: futureExpiry(),
      attempts: 5,
      max_attempts: 5,
    });
    const verificationUpdate = jest.fn();
    prismaService.db.verificationCode.update = verificationUpdate;

    await expect(
      verificationCodesService.consume({
        userId: 'user-1',
        target: 'sara@example.com',
        purpose: 'SIGNUP',
        code: '123456',
      }),
    ).rejects.toMatchObject({
      response: { code: ERROR_CODES.MAX_ATTEMPTS_EXCEEDED },
    });

    // No update at all — the row is exhausted; we don't even spend a bcrypt compare.
    expect(verificationUpdate).not.toHaveBeenCalled();
  });

  it('rejects with CODE_EXPIRED when expires_at is in the past', async () => {
    const { verificationCodesService, mocks } = createAuthTestEnv();
    const code_hash = await bcrypt.hash('123456', 10);
    mocks.verificationFindFirst.mockResolvedValue({
      id: 'verification-row-id',
      code_hash,
      expires_at: new Date(Date.now() - 1000),
      attempts: 0,
      max_attempts: 5,
    });

    await expect(
      verificationCodesService.consume({
        userId: 'user-1',
        target: 'sara@example.com',
        purpose: 'SIGNUP',
        code: '123456',
      }),
    ).rejects.toMatchObject({
      response: { code: ERROR_CODES.CODE_EXPIRED },
    });
  });

  it('rejects with INVALID_CODE when no unconsumed verification row exists', async () => {
    const { verificationCodesService, mocks } = createAuthTestEnv();
    mocks.verificationFindFirst.mockResolvedValue(null);

    await expect(
      verificationCodesService.consume({
        userId: 'user-1',
        target: 'sara@example.com',
        purpose: 'SIGNUP',
        code: '123456',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

describe('VerificationCodesService.send', () => {
  it('consumes any outstanding codes, creates a fresh one, and emails the cleartext', async () => {
    const { verificationCodesService, mocks } = createAuthTestEnv();
    mocks.verificationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.verificationCreate.mockResolvedValue({});

    await verificationCodesService.send({
      userId: 'user-1',
      target: 'sara@example.com',
      purpose: 'SIGNUP',
    });

    // Outstanding (unconsumed) codes for this purpose are closed first.
    expect(mocks.verificationUpdateMany).toHaveBeenCalledWith({
      where: { user_id: 'user-1', purpose: 'SIGNUP', consumed_at: null },
      data: { consumed_at: expect.any(Date) },
    });
    // A new code row is written with a hashed code and an expiry.
    expect(mocks.verificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 'user-1',
          target: 'sara@example.com',
          channel: 'EMAIL',
          purpose: 'SIGNUP',
          code_hash: expect.any(String),
          expires_at: expect.any(Date),
          is_resend: false,
        }),
      }),
    );
    // The cleartext code (6 digits) is emailed, never persisted.
    expect(mocks.sendVerificationEmail).toHaveBeenCalledTimes(1);
    const emailedCode = mocks.sendVerificationEmail.mock.calls[0][1] as string;
    expect(emailedCode).toMatch(/^\d{6}$/);
  });

  it('routes both writes through the supplied transaction, then sends email after', async () => {
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const txCreate = jest.fn().mockResolvedValue({});
    const { verificationCodesService, mocks } = createAuthTestEnv();

    await verificationCodesService.send(
      {
        userId: 'user-1',
        target: 'sara@example.com',
        purpose: 'SIGNUP',
        isResend: true,
      },
      {
        verificationCode: { updateMany: txUpdateMany, create: txCreate },
      } as never,
    );

    // The tx client was used, NOT the default prisma client.
    expect(txUpdateMany).toHaveBeenCalledTimes(1);
    expect(txCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ is_resend: true }),
      }),
    );
    expect(mocks.verificationUpdateMany).not.toHaveBeenCalled();
    expect(mocks.verificationCreate).not.toHaveBeenCalled();
    // Email is dispatched once after the writes.
    expect(mocks.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });
});

describe('VerificationCodesService.assertCanResend', () => {
  it('rejects with 429 while a resend is still within the cooldown window', async () => {
    const { verificationCodesService, mocks } = createAuthTestEnv();
    mocks.verificationFindFirst.mockResolvedValue({ created_at: new Date() });

    await expect(
      verificationCodesService.assertCanResend({
        userId: 'user-1',
        purpose: 'SIGNUP',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    // Short-circuits on cooldown — never reaches the hourly count check.
    expect(mocks.verificationCount).not.toHaveBeenCalled();
  });

  it('rejects with 429 once the hourly resend cap is reached', async () => {
    const { verificationCodesService, mocks } = createAuthTestEnv();
    // Last resend is older than the 60s cooldown, but the hourly count is maxed.
    mocks.verificationFindFirst.mockResolvedValue({
      created_at: new Date(Date.now() - 61_000),
    });
    mocks.verificationCount.mockResolvedValue(5);

    await expect(
      verificationCodesService.assertCanResend({
        userId: 'user-1',
        purpose: 'SIGNUP',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('resolves when there is no prior resend and the hourly count is under the cap', async () => {
    const { verificationCodesService, mocks } = createAuthTestEnv();
    mocks.verificationFindFirst.mockResolvedValue(null);
    mocks.verificationCount.mockResolvedValue(0);

    await expect(
      verificationCodesService.assertCanResend({
        userId: 'user-1',
        purpose: 'SIGNUP',
      }),
    ).resolves.toBeUndefined();
  });
});
