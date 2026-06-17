import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import { AUTH_EVENTS } from '../events/auth.events.js';
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

  it('reactivation path runs user.update + verification-code persistence in one transaction (S-11)', async () => {
    const txUserUpdate = jest.fn().mockResolvedValue({});
    const txVerificationUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const txVerificationCreate = jest.fn().mockResolvedValue({});
    const $transaction = jest.fn(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          user: { update: txUserUpdate },
          verificationCode: {
            updateMany: txVerificationUpdateMany,
            create: txVerificationCreate,
          },
        }),
    );
    const { signupService, mocks } = createAuthTestEnv({ $transaction });
    mocks.userFindFirst.mockResolvedValue({
      id: 'soft-deleted-user',
      email: 'sara@example.com',
      is_deleted: true,
      registration_status: 'ACTIVE',
    });

    await signupService.start({
      first_name: 'Sara',
      last_name: 'Ali',
      email: 'sara@example.com',
      password: 'Password1!',
      confirm_password: 'Password1!',
    });

    expect($transaction).toHaveBeenCalledTimes(1);
    // user.update + verificationCode writes all flowed through the same tx.
    expect(txUserUpdate).toHaveBeenCalledTimes(1);
    expect(txVerificationCreate).toHaveBeenCalledTimes(1);
    // The dedicated non-tx prisma path was NOT used for the verification
    // writes — that's the bug being closed.
    expect(mocks.verificationCreate).not.toHaveBeenCalled();
    // Email was still dispatched (inside the tx, but that's an
    // acceptable trade-off documented in the service).
    expect(mocks.sendVerificationEmail).toHaveBeenCalledTimes(1);
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
          findMany: jest.fn().mockResolvedValue([]),
        },
        specialty: { findMany: jest.fn().mockResolvedValue([]) },
      });

      await expect(
        signupService.complete({
          ...baseDto,
          signup_token: signSignupToken(jwtService, userId),
          job_function_code: 'BOGUS_FN',
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

  describe('complete success path', () => {
    const userId = 'user-id';
    const baseDto = {
      organization_name: 'Cradlen Clinic',
      specialties: [] as string[],
      branch_name: 'Main',
      branch_address: '1 St',
      branch_city: 'Cairo',
      branch_governorate: 'Cairo',
    };

    function buildCompleteEnv() {
      const txMock = {
        user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        organization: {
          create: jest.fn().mockResolvedValue({ id: 'org-id' }),
        },
        branch: { create: jest.fn().mockResolvedValue({ id: 'branch-id' }) },
        profile: { create: jest.fn().mockResolvedValue({ id: 'profile-id' }) },
        subscription: { create: jest.fn().mockResolvedValue({}) },
      };
      const env = createAuthTestEnv({
        $transaction: jest
          .fn()
          .mockImplementation((fn: (tx: typeof txMock) => Promise<unknown>) =>
            fn(txMock),
          ),
        user: {
          findFirst: jest.fn().mockResolvedValue({
            id: userId,
            email: 'sara@example.com',
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
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'jf-id', code: 'OBGYN' }]),
        },
        specialty: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'spec-id', code: 'OBGYN' }]),
        },
        // buildProfileSelectionResponse → getSelectableProfiles
        profile: { findMany: jest.fn().mockResolvedValue([]) },
      });
      return { env, txMock };
    }

    it('creates org + branch + profile + subscription, publishes signup.completed, and returns a profile selection', async () => {
      const { env, txMock } = buildCompleteEnv();
      const { signupService, jwtService, publish } = env;

      const result = await signupService.complete({
        ...baseDto,
        signup_token: signSignupToken(jwtService, userId),
        specialties: ['OBGYN'],
        job_function_code: 'OBGYN',
      });

      expect(txMock.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Cradlen Clinic' }),
        }),
      );
      expect(txMock.branch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organization_id: 'org-id',
            is_main: true,
          }),
        }),
      );
      expect(txMock.profile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: userId,
            organization_id: 'org-id',
            engagement_type: 'FULL_TIME',
            role_id: 'role-id',
          }),
        }),
      );
      expect(txMock.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organization_id: 'org-id',
            subscription_plan_id: 'plan-id',
          }),
        }),
      );
      expect(publish).toHaveBeenCalledWith(
        AUTH_EVENTS.signup.completed,
        expect.objectContaining({
          user_id: userId,
          organization_id: 'org-id',
          profile_id: 'profile-id',
          email: 'sara@example.com',
        }),
      );
      expect(result.type).toBe('profile_selection');
      expect(result.selection_token).toEqual(expect.any(String));
    });

    it('links the owner to the main branch and persists executive/professional titles', async () => {
      const { env, txMock } = buildCompleteEnv();
      const { signupService, jwtService } = env;

      await signupService.complete({
        ...baseDto,
        signup_token: signSignupToken(jwtService, userId),
        specialties: ['OBGYN'],
        practitioner_specialty_code: 'OBGYN',
        job_function_code: 'OBGYN',
        executive_title: 'CEO' as never,
        professional_title: 'استشاري النساء والتوليد',
      });

      // Org gets the offered specialties.
      expect(txMock.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            specialty_links: { create: [{ specialty_id: 'spec-id' }] },
          }),
        }),
      );
      const profileData = txMock.profile.create.mock.calls[0][0].data;
      // Owner is linked to the freshly created main branch.
      expect(profileData.branches).toEqual({
        create: [{ organization_id: 'org-id', branch_id: 'branch-id' }],
      });
      // Practitioner specialty lands on the profile; titles persist.
      expect(profileData.specialty_id).toBe('spec-id');
      expect(profileData.executive_title).toBe('CEO');
      expect(profileData.professional_title).toBe('استشاري النساء والتوليد');
    });

    it('leaves the owner profile clinical-free when not a practitioner', async () => {
      const { env, txMock } = buildCompleteEnv();
      const { signupService, jwtService } = env;

      await signupService.complete({
        ...baseDto,
        signup_token: signSignupToken(jwtService, userId),
        specialties: ['OBGYN'],
        executive_title: 'CEO' as never,
      });

      const profileData = txMock.profile.create.mock.calls[0][0].data;
      // No practitioner specialty / job function → null/undefined on the profile.
      expect(profileData.specialty_id).toBeNull();
      expect(profileData.subspecialty_links).toBeUndefined();
      expect(profileData.job_function_id).toBeNull();
      expect(profileData.professional_title).toBeNull();
      // Org still records its offered specialties.
      expect(txMock.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            specialty_links: { create: [{ specialty_id: 'spec-id' }] },
          }),
        }),
      );
    });

    it('throws InternalServerErrorException when the free-trial plan is not seeded', async () => {
      const { env } = buildCompleteEnv();
      env.prismaService.db.subscriptionPlan.findUnique = jest
        .fn()
        .mockResolvedValue(null);

      await expect(
        env.signupService.complete({
          ...baseDto,
          signup_token: signSignupToken(env.jwtService, userId),
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('throws InternalServerErrorException when the OWNER role is not seeded', async () => {
      const { env } = buildCompleteEnv();
      env.prismaService.db.role.findUnique = jest.fn().mockResolvedValue(null);

      await expect(
        env.signupService.complete({
          ...baseDto,
          signup_token: signSignupToken(env.jwtService, userId),
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('throws ForbiddenException when the user has not verified their email', async () => {
      const { env } = buildCompleteEnv();
      env.prismaService.db.user.findFirst = jest.fn().mockResolvedValue({
        id: userId,
        email: 'sara@example.com',
        registration_status: 'PENDING',
        verified_at: null,
        onboarding_completed: false,
        is_active: true,
      });

      await expect(
        env.signupService.complete({
          ...baseDto,
          signup_token: signSignupToken(env.jwtService, userId),
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws UnauthorizedException when the token references no active user', async () => {
      const { env } = buildCompleteEnv();
      env.prismaService.db.user.findFirst = jest.fn().mockResolvedValue(null);

      await expect(
        env.signupService.complete({
          ...baseDto,
          signup_token: signSignupToken(env.jwtService, userId),
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('verify token + user guards', () => {
    const userId = '11111111-1111-4111-8111-111111111111';

    it('rejects an invalid signup token before touching the database', async () => {
      const { signupService, mocks } = createAuthTestEnv();

      await expect(
        signupService.verify({
          signup_token: 'not-a-real-jwt',
          code: '123456',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mocks.userFindFirst).not.toHaveBeenCalled();
    });

    it('rejects with UnauthorizedException when the user is missing or soft-deleted', async () => {
      const { signupService, mocks, jwtService } = createAuthTestEnv();
      mocks.userFindFirst.mockResolvedValue(null);

      await expect(
        signupService.verify({
          signup_token: signSignupToken(jwtService, userId),
          code: '123456',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mocks.verificationFindFirst).not.toHaveBeenCalled();
    });
  });

  describe('getRegistrationStatus guards', () => {
    it('throws UnauthorizedException for an invalid bearer token with no email fallback', async () => {
      const { signupService } = createAuthTestEnv();

      await expect(
        signupService.getRegistrationStatus({
          authorization: 'Bearer not-a-real-jwt',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws BadRequestException when neither email nor authorization is supplied', async () => {
      const { signupService } = createAuthTestEnv();

      await expect(
        signupService.getRegistrationStatus({}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
