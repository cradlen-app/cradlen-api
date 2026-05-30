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
