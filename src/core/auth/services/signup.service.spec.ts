import { ConflictException, HttpException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import { createAuthTestEnv } from './test-env.js';

describe('SignupService', () => {
  async function expectTooManyRequests(action: Promise<unknown>) {
    await expect(action).rejects.toBeInstanceOf(HttpException);
    await expect(action).rejects.toMatchObject({ status: 429 });
  }

  function signSignupToken(
    jwtService: { sign: (p: object, o: object) => string },
    userId: string,
  ) {
    return jwtService.sign(
      { userId, type: 'signup' },
      { secret: 'access-secret' },
    );
  }

  it('resends signup OTP when signup start is retried for a pending user', async () => {
    const { signupService, mocks } = createAuthTestEnv();
    const existingUser = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
      registration_status: 'PENDING',
    };
    mocks.userFindFirst
      .mockResolvedValueOnce(existingUser)
      .mockResolvedValueOnce(existingUser);
    mocks.verificationFindFirst.mockResolvedValue(null);
    mocks.verificationCount.mockResolvedValue(0);
    mocks.verificationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.verificationCreate.mockResolvedValue({});

    const result = await signupService.start({
      first_name: 'Sara',
      last_name: 'Ali',
      email: 'sara@example.com',
      password: 'Password1!',
      confirm_password: 'Password1!',
    });

    expect(result.signup_token).toEqual(expect.any(String));
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.verificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purpose: 'SIGNUP',
          is_resend: true,
        }),
      }),
    );
    expect(mocks.sendVerificationEmail).toHaveBeenCalled();
  });

  it('rejects signup start when active email already exists', async () => {
    const { signupService, mocks } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue({
      id: 'existing-user',
      registration_status: 'ACTIVE',
    });

    await expect(
      signupService.start({
        first_name: 'Sara',
        last_name: 'Ali',
        email: 'sara@example.com',
        password: 'Password1!',
        confirm_password: 'Password1!',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects signup start when active phone already exists', async () => {
    const { signupService, mocks } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue({
      id: 'existing-user',
      registration_status: 'ACTIVE',
    });

    await expect(
      signupService.start({
        first_name: 'Sara',
        last_name: 'Ali',
        email: 'sara@example.com',
        phone_number: '+201012345678',
        password: 'Password1!',
        confirm_password: 'Password1!',
      }),
    ).rejects.toThrow(ConflictException);
    expect(mocks.userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { email: 'sara@example.com' },
            { phone_number: '+201012345678' },
          ],
        }),
      }),
    );
  });

  it('creates pending user and sends signup verification code', async () => {
    const { signupService, mocks } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue(null);
    mocks.userCreate.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
    });
    mocks.verificationUpdateMany.mockResolvedValue({ count: 0 });
    mocks.verificationCreate.mockResolvedValue({});

    const result = await signupService.start({
      first_name: 'Sara',
      last_name: 'Ali',
      email: 'sara@example.com',
      phone_number: '+201012345678',
      password: 'Password1!',
      confirm_password: 'Password1!',
    });

    expect(result.signup_token).toEqual(expect.any(String));
    expect(mocks.userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          registration_status: 'PENDING',
          onboarding_completed: false,
          phone_number: '+201012345678',
        }),
      }),
    );
    expect(mocks.sendVerificationEmail).toHaveBeenCalled();
  });

  it('returns success for resend when email is unknown', async () => {
    const { signupService, mocks } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue(null);

    await expect(
      signupService.resendOtp({ email: 'missing@example.com' }),
    ).resolves.toEqual({ success: true });
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('resends signup OTP for pending users with resend tracking', async () => {
    const { signupService, mocks } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
      registration_status: 'PENDING',
    });
    mocks.verificationFindFirst.mockResolvedValue(null);
    mocks.verificationCount.mockResolvedValue(0);
    mocks.verificationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.verificationCreate.mockResolvedValue({});

    await expect(
      signupService.resendOtp({ email: 'sara@example.com' }),
    ).resolves.toEqual({ success: true });
    expect(mocks.verificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purpose: 'SIGNUP',
          is_resend: true,
        }),
      }),
    );
    expect(mocks.sendVerificationEmail).toHaveBeenCalled();
  });

  it('rejects resend during cooldown', async () => {
    const { signupService, mocks } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
      registration_status: 'PENDING',
    });
    mocks.verificationFindFirst.mockResolvedValue({
      created_at: new Date(),
    });

    await expectTooManyRequests(
      signupService.resendOtp({ email: 'sara@example.com' }),
    );
  });

  it('rejects resend after hourly limit is reached', async () => {
    const { signupService, mocks } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
      registration_status: 'PENDING',
    });
    mocks.verificationFindFirst.mockResolvedValue({
      created_at: new Date(Date.now() - 61_000),
    });
    mocks.verificationCount.mockResolvedValue(5);

    await expectTooManyRequests(
      signupService.resendOtp({ email: 'sara@example.com' }),
    );
  });

  it('rejects resend for active users', async () => {
    const { signupService, mocks } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
      registration_status: 'ACTIVE',
    });

    await expect(
      signupService.resendOtp({ email: 'sara@example.com' }),
    ).rejects.toThrow(ConflictException);
  });

  it('returns NONE registration status without exposing public email', async () => {
    const { signupService, mocks } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue(null);

    await expect(
      signupService.getRegistrationStatus({ email: 'missing@example.com' }),
    ).resolves.toEqual({ step: 'NONE' });
  });

  it.each([
    ['PENDING', false, 'VERIFY_OTP'],
    ['ACTIVE', false, 'COMPLETE_ONBOARDING'],
    ['ACTIVE', true, 'DONE'],
  ] as const)(
    'maps %s registration status with onboarding=%s to %s',
    async (registration_status, onboarding_completed, step) => {
      const { signupService, mocks } = createAuthTestEnv();
      mocks.userFindFirst.mockResolvedValue({
        registration_status,
        onboarding_completed,
      });

      await expect(
        signupService.getRegistrationStatus({ email: 'sara@example.com' }),
      ).resolves.toEqual({ step });
    },
  );

  it('includes email for valid bearer registration status', async () => {
    const { signupService, mocks, jwtService } = createAuthTestEnv();
    mocks.userFindFirst.mockResolvedValue({
      email: 'sara@example.com',
      registration_status: 'ACTIVE',
      onboarding_completed: true,
    });
    const token = jwtService.sign(
      {
        userId: '11111111-1111-4111-8111-111111111111',
        profileId: '22222222-2222-4222-8222-222222222222',
        organizationId: '33333333-3333-4333-8333-333333333333',
        type: 'access',
      },
      { secret: 'access-secret' },
    );

    await expect(
      signupService.getRegistrationStatus({
        authorization: `Bearer ${token}`,
      }),
    ).resolves.toEqual({ step: 'DONE', email: 'sara@example.com' });
  });

  it('returns 409 and does not resend OTP when pending user found only by phone collision', async () => {
    const { signupService, mocks } = createAuthTestEnv();
    // Existing PENDING user has a different email but the same phone number.
    mocks.userFindFirst.mockResolvedValue({
      id: 'other-user-id',
      email: 'other@example.com',
      phone_number: '+201012345678',
      registration_status: 'PENDING',
    });

    await expect(
      signupService.start({
        first_name: 'Sara',
        last_name: 'Ali',
        email: 'sara@example.com',
        phone_number: '+201012345678',
        password: 'Password1!',
        confirm_password: 'Password1!',
      }),
    ).rejects.toThrow(ConflictException);

    // Must never issue a token or send email for the phone-matched user.
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('resumes pending registration only when email matches, ignoring phone', async () => {
    const { signupService, mocks } = createAuthTestEnv();
    const existingUser = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
      phone_number: '+201012345678',
      registration_status: 'PENDING',
    };
    // findFirst returns the same user twice: once for the existence check,
    // once inside resendOtp.
    mocks.userFindFirst
      .mockResolvedValueOnce(existingUser)
      .mockResolvedValueOnce(existingUser);
    mocks.verificationFindFirst.mockResolvedValue(null);
    mocks.verificationCount.mockResolvedValue(0);
    mocks.verificationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.verificationCreate.mockResolvedValue({});

    const result = await signupService.start({
      first_name: 'Sara',
      last_name: 'Ali',
      email: 'sara@example.com',
      phone_number: '+201012345678',
      password: 'Password1!',
      confirm_password: 'Password1!',
    });

    expect(result.signup_token).toEqual(expect.any(String));
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('returns 409 on duplicate signupComplete without creating extra tenant records', async () => {
    const organizationCreate = jest.fn();
    const txMock = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      organization: { create: organizationCreate },
      branch: { create: jest.fn() },
      profile: { create: jest.fn() },
      subscription: { create: jest.fn() },
    };
    const { signupService, jwtService } = createAuthTestEnv({
      $transaction: jest
        .fn()
        .mockImplementation((fn: (tx: typeof txMock) => Promise<unknown>) =>
          fn(txMock),
        ),
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'user-id',
          registration_status: 'ACTIVE',
          verified_at: new Date(),
          onboarding_completed: false,
          is_active: true,
        }),
        updateMany: jest.fn(),
      },
      role: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'role-id', name: 'OWNER' }),
      },
      subscriptionPlan: {
        findUnique: jest.fn().mockResolvedValue({ id: 'plan-id' }),
      },
      jobFunction: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      specialty: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    const signupToken = jwtService.sign(
      { userId: 'user-id', type: 'signup' },
      { secret: 'access-secret' },
    );

    await expect(
      signupService.complete({
        signup_token: signupToken,
        organization_name: 'Clinic',
        specialties: ['General Medicine'],
        branch_name: 'Main Branch',
        branch_address: '1 Clinic St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
      }),
    ).rejects.toThrow(ConflictException);

    // The transaction is entered but no organization is created.
    expect(organizationCreate).not.toHaveBeenCalled();
  });

  describe('verify', () => {
    const userId = '11111111-1111-4111-8111-111111111111';

    it('marks user verified, consumes the code, and returns a fresh signup token', async () => {
      const { signupService, mocks, prismaService, jwtService } =
        createAuthTestEnv();
      mocks.userFindFirst.mockResolvedValue({
        id: userId,
        email: 'sara@example.com',
        registration_status: 'PENDING',
      });
      const code_hash = await bcrypt.hash('123456', 10);
      mocks.verificationFindFirst.mockResolvedValue({
        id: 'verification-row',
        code_hash,
        expires_at: new Date(Date.now() + 60_000),
        attempts: 0,
        max_attempts: 5,
      });
      const verificationUpdate = jest.fn().mockResolvedValue({});
      prismaService.db.verificationCode.update = verificationUpdate;
      mocks.userUpdate.mockResolvedValue({});

      const result = await signupService.verify({
        signup_token: signSignupToken(jwtService, userId),
        code: '123456',
      });

      expect(result.signup_token).toEqual(expect.any(String));
      expect(mocks.userUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: userId },
          data: expect.objectContaining({
            verified_at: expect.any(Date),
            registration_status: 'ACTIVE',
            is_active: true,
          }),
        }),
      );
      // consumed_at, not increment — the matching path closes the row.
      expect(verificationUpdate).toHaveBeenCalledWith({
        where: { id: 'verification-row' },
        data: { consumed_at: expect.any(Date) },
      });
    });

    it('rejects with CODE_EXPIRED when the verification row is past expires_at', async () => {
      const { signupService, mocks, jwtService } = createAuthTestEnv();
      mocks.userFindFirst.mockResolvedValue({
        id: userId,
        email: 'sara@example.com',
        registration_status: 'PENDING',
      });
      const code_hash = await bcrypt.hash('123456', 10);
      mocks.verificationFindFirst.mockResolvedValue({
        id: 'verification-row',
        code_hash,
        expires_at: new Date(Date.now() - 1000),
        attempts: 0,
        max_attempts: 5,
      });

      await expect(
        signupService.verify({
          signup_token: signSignupToken(jwtService, userId),
          code: '123456',
        }),
      ).rejects.toMatchObject({
        response: { code: ERROR_CODES.CODE_EXPIRED },
      });
      expect(mocks.userUpdate).not.toHaveBeenCalled();
    });

    it('rejects with INVALID_CODE on wrong code and does not mark the user verified', async () => {
      const { signupService, mocks, prismaService, jwtService } =
        createAuthTestEnv();
      mocks.userFindFirst.mockResolvedValue({
        id: userId,
        email: 'sara@example.com',
        registration_status: 'PENDING',
      });
      const code_hash = await bcrypt.hash('123456', 10);
      mocks.verificationFindFirst.mockResolvedValue({
        id: 'verification-row',
        code_hash,
        expires_at: new Date(Date.now() + 60_000),
        attempts: 0,
        max_attempts: 5,
      });
      const verificationUpdate = jest.fn().mockResolvedValue({});
      prismaService.db.verificationCode.update = verificationUpdate;

      await expect(
        signupService.verify({
          signup_token: signSignupToken(jwtService, userId),
          code: '999999',
        }),
      ).rejects.toMatchObject({
        response: { code: ERROR_CODES.INVALID_CODE },
      });
      expect(mocks.userUpdate).not.toHaveBeenCalled();
      // Only the atomic attempts increment ran — no consumed_at, no user.update.
      expect(verificationUpdate).toHaveBeenCalledWith({
        where: { id: 'verification-row' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('rejects with ConflictException when the user is already verified', async () => {
      const { signupService, mocks, jwtService } = createAuthTestEnv();
      mocks.userFindFirst.mockResolvedValue({
        id: userId,
        email: 'sara@example.com',
        registration_status: 'ACTIVE',
      });

      await expect(
        signupService.verify({
          signup_token: signSignupToken(jwtService, userId),
          code: '123456',
        }),
      ).rejects.toThrow(ConflictException);
      expect(mocks.verificationFindFirst).not.toHaveBeenCalled();
    });
  });

  describe('complete edge cases', () => {
    const userId = 'user-id';
    const baseDto = {
      organization_name: 'Clinic',
      specialties: [] as string[],
      branch_name: 'Main',
      branch_address: '1 St',
      branch_city: 'Cairo',
      branch_governorate: 'Cairo',
    };
    const baseOverrides = () => ({
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: userId,
          registration_status: 'ACTIVE',
          verified_at: new Date(),
          onboarding_completed: false,
          is_active: true,
        }),
        updateMany: jest.fn(),
      },
      role: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'role-id', name: 'OWNER' }),
      },
      subscriptionPlan: {
        findUnique: jest.fn().mockResolvedValue({ id: 'plan-id' }),
      },
    });

    it('rejects with BadRequestException listing the unknown job_function_codes', async () => {
      const { signupService, jwtService } = createAuthTestEnv({
        ...baseOverrides(),
        jobFunction: {
          findMany: jest.fn().mockResolvedValue([{ code: 'OBGYN' }]),
        },
        specialty: { findMany: jest.fn().mockResolvedValue([]) },
      });

      await expect(
        signupService.complete({
          ...baseDto,
          signup_token: signSignupToken(jwtService, userId),
          job_function_codes: ['OBGYN', 'BOGUS_FN'],
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('BOGUS_FN'),
      });
    });

    it('resolves specialties by code OR case-insensitive name in a single query', async () => {
      const specialtyFindMany = jest.fn().mockResolvedValue([]);
      const { signupService, jwtService } = createAuthTestEnv({
        ...baseOverrides(),
        jobFunction: { findMany: jest.fn().mockResolvedValue([]) },
        specialty: { findMany: specialtyFindMany },
      });

      // We expect the resolution query to run; the transaction itself will
      // throw because $transaction is the default jest.fn() mock — that is
      // fine, this test only asserts the specialty lookup shape.
      await signupService
        .complete({
          ...baseDto,
          signup_token: signSignupToken(jwtService, userId),
          specialties: ['OBGYN', 'general medicine'],
        })
        .catch(() => undefined);

      expect(specialtyFindMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { code: { in: ['OBGYN', 'general medicine'] } },
            {
              name: {
                in: ['OBGYN', 'general medicine'],
                mode: 'insensitive',
              },
            },
          ],
          is_deleted: false,
        },
      });
    });
  });
});
