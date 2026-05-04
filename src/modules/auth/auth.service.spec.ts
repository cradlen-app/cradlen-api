import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { MailService } from '../mail/mail.service.js';

function createService(prismaOverrides: Record<string, unknown> = {}) {
  const userFindFirst = jest.fn();
  const userCreate = jest.fn();
  const userUpdate = jest.fn();
  const verificationUpdateMany = jest.fn();
  const verificationCreate = jest.fn();
  const verificationFindFirst = jest.fn();
  const verificationUpdate = jest.fn();
  const verificationCount = jest.fn();
  const profileFindFirst = jest.fn();
  const profileFindMany = jest.fn();
  const refreshTokenCreate = jest.fn();
  const sendVerificationEmail = jest.fn();

  const prismaService = {
    db: {
      user: {
        findFirst: userFindFirst,
        create: userCreate,
        update: userUpdate,
        updateMany: jest.fn(),
      },
      verificationCode: {
        updateMany: verificationUpdateMany,
        create: verificationCreate,
        findFirst: verificationFindFirst,
        update: verificationUpdate,
        count: verificationCount,
      },
      role: { findUnique: jest.fn() },
      subscriptionPlan: { findUnique: jest.fn() },
      refreshToken: {
        create: refreshTokenCreate,
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      profile: { findMany: profileFindMany, findFirst: profileFindFirst },
      $transaction: jest.fn(),
      ...prismaOverrides,
    },
  } as unknown as PrismaService;

  const jwtService = new JwtService();
  const configService = {
    get: jest.fn().mockReturnValue({
      jwt: {
        accessSecret: 'access-secret',
        refreshSecret: 'refresh-secret',
        accessExpiration: '15m',
        refreshExpiration: '7d',
        registrationExpiration: '30m',
      },
      freeTrialDays: 14,
      invitationExpireHours: 72,
      resend: { apiKey: 'key', fromEmail: 'noreply@example.com' },
    }),
  };
  const mailService = {
    sendVerificationEmail,
  } as unknown as MailService;

  return {
    service: new AuthService(
      prismaService,
      jwtService,
      configService as never,
      mailService,
    ),
    prismaService,
    mailService,
    mocks: {
      userFindFirst,
      userCreate,
      userUpdate,
      verificationUpdateMany,
      verificationCreate,
      verificationFindFirst,
      verificationCount,
      profileFindFirst,
      profileFindMany,
      refreshTokenCreate,
      sendVerificationEmail,
    },
    jwtService,
  };
}

describe('AuthService', () => {
  async function expectTooManyRequests(action: Promise<unknown>) {
    await expect(action).rejects.toBeInstanceOf(HttpException);
    await expect(action).rejects.toMatchObject({ status: 429 });
  }

  it('resends signup OTP when signup start is retried for a pending user', async () => {
    const { service, mocks } = createService();
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

    const result = await service.signupStart({
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
    const { service, mocks } = createService();
    mocks.userFindFirst.mockResolvedValue({
      id: 'existing-user',
      registration_status: 'ACTIVE',
    });

    await expect(
      service.signupStart({
        first_name: 'Sara',
        last_name: 'Ali',
        email: 'sara@example.com',
        password: 'Password1!',
        confirm_password: 'Password1!',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects signup start when active phone already exists', async () => {
    const { service, mocks } = createService();
    mocks.userFindFirst.mockResolvedValue({
      id: 'existing-user',
      registration_status: 'ACTIVE',
    });

    await expect(
      service.signupStart({
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
    const { service, mocks } = createService();
    mocks.userFindFirst.mockResolvedValue(null);
    mocks.userCreate.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
    });
    mocks.verificationUpdateMany.mockResolvedValue({ count: 0 });
    mocks.verificationCreate.mockResolvedValue({});

    const result = await service.signupStart({
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
    const { service, mocks } = createService();
    mocks.userFindFirst.mockResolvedValue(null);

    await expect(
      service.resendOtp({ email: 'missing@example.com' }),
    ).resolves.toEqual({ success: true });
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('resends signup OTP for pending users with resend tracking', async () => {
    const { service, mocks } = createService();
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
      service.resendOtp({ email: 'sara@example.com' }),
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
    const { service, mocks } = createService();
    mocks.userFindFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
      registration_status: 'PENDING',
    });
    mocks.verificationFindFirst.mockResolvedValue({
      created_at: new Date(),
    });

    await expectTooManyRequests(
      service.resendOtp({ email: 'sara@example.com' }),
    );
  });

  it('rejects resend after hourly limit is reached', async () => {
    const { service, mocks } = createService();
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
      service.resendOtp({ email: 'sara@example.com' }),
    );
  });

  it('rejects resend for active users', async () => {
    const { service, mocks } = createService();
    mocks.userFindFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
      registration_status: 'ACTIVE',
    });

    await expect(
      service.resendOtp({ email: 'sara@example.com' }),
    ).rejects.toThrow(ConflictException);
  });

  it('returns NONE registration status without exposing public email', async () => {
    const { service, mocks } = createService();
    mocks.userFindFirst.mockResolvedValue(null);

    await expect(
      service.getRegistrationStatus({ email: 'missing@example.com' }),
    ).resolves.toEqual({ step: 'NONE' });
  });

  it.each([
    ['PENDING', false, 'VERIFY_OTP'],
    ['ACTIVE', false, 'COMPLETE_ONBOARDING'],
    ['ACTIVE', true, 'DONE'],
  ] as const)(
    'maps %s registration status with onboarding=%s to %s',
    async (registration_status, onboarding_completed, step) => {
      const { service, mocks } = createService();
      mocks.userFindFirst.mockResolvedValue({
        registration_status,
        onboarding_completed,
      });

      await expect(
        service.getRegistrationStatus({ email: 'sara@example.com' }),
      ).resolves.toEqual({ step });
    },
  );

  it('includes email for valid bearer registration status', async () => {
    const { service, mocks, jwtService } = createService();
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
      service.getRegistrationStatus({
        authorization: `Bearer ${token}`,
      }),
    ).resolves.toEqual({ step: 'DONE', email: 'sara@example.com' });
  });

  it('returns verify OTP onboarding requirement when pending user logs in', async () => {
    const { service, mocks } = createService();
    mocks.userFindFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
      password_hashed: await bcrypt.hash('Password1!', 12),
      is_active: true,
      registration_status: 'PENDING',
      onboarding_completed: false,
    });

    await expect(
      service.login({ email: 'sara@example.com', password: 'Password1!' }),
    ).resolves.toEqual({
      type: 'ONBOARDING_REQUIRED',
      step: 'VERIFY_OTP',
    });
    expect(mocks.profileFindMany).not.toHaveBeenCalled();
  });

  it('returns complete onboarding requirement for active users without onboarding', async () => {
    const { service, mocks } = createService();
    mocks.userFindFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
      password_hashed: await bcrypt.hash('Password1!', 12),
      is_active: true,
      registration_status: 'ACTIVE',
      onboarding_completed: false,
    });

    await expect(
      service.login({ email: 'sara@example.com', password: 'Password1!' }),
    ).resolves.toEqual({
      type: 'ONBOARDING_REQUIRED',
      step: 'COMPLETE_ONBOARDING',
    });
    expect(mocks.profileFindMany).not.toHaveBeenCalled();
  });

  it('returns profile selection for active users with completed onboarding', async () => {
    const { service, mocks } = createService();
    mocks.userFindFirst.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
      password_hashed: await bcrypt.hash('Password1!', 12),
      is_active: true,
      registration_status: 'ACTIVE',
      onboarding_completed: true,
    });
    mocks.profileFindMany.mockResolvedValue([
      {
        id: '22222222-2222-4222-8222-222222222222',
        organization: {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Clinic',
        },
        roles: [{ role: { name: 'OWNER' } }],
        branches: [
          {
            branch_id: '44444444-4444-4444-8444-444444444444',
            branch: {
              id: '44444444-4444-4444-8444-444444444444',
              name: 'Main',
              is_main: true,
            },
          },
        ],
      },
    ]);

    await expect(
      service.login({ email: 'sara@example.com', password: 'Password1!' }),
    ).resolves.toEqual({
      type: 'profile_selection',
      selection_token: expect.any(String),
      profiles: [
        {
          profile_id: '22222222-2222-4222-8222-222222222222',
          organization_id: '33333333-3333-4333-8333-333333333333',
          organization_name: 'Clinic',
          roles: ['OWNER'],
          branches: [
            {
              branch_id: '44444444-4444-4444-8444-444444444444',
              name: 'Main',
              is_main: true,
            },
          ],
        },
      ],
    });
  });

  it('requires branch id when selected profile has multiple branches', async () => {
    const { service, mocks, jwtService } = createService();
    const selectionToken = jwtService.sign(
      {
        userId: '11111111-1111-4111-8111-111111111111',
        type: 'profile_selection',
      },
      { secret: 'access-secret' },
    );
    mocks.profileFindFirst.mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      organization_id: '33333333-3333-4333-8333-333333333333',
      user: { id: '11111111-1111-4111-8111-111111111111' },
      branches: [
        { branch_id: '44444444-4444-4444-8444-444444444444' },
        { branch_id: '55555555-5555-4555-8555-555555555555' },
      ],
    });

    await expect(
      service.selectProfile({
        selection_token: selectionToken,
        profile_id: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects branch ids outside the selected profile', async () => {
    const { service, mocks, jwtService } = createService();
    const selectionToken = jwtService.sign(
      {
        userId: '11111111-1111-4111-8111-111111111111',
        type: 'profile_selection',
      },
      { secret: 'access-secret' },
    );
    mocks.profileFindFirst.mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      organization_id: '33333333-3333-4333-8333-333333333333',
      user: { id: '11111111-1111-4111-8111-111111111111' },
      branches: [{ branch_id: '44444444-4444-4444-8444-444444444444' }],
    });

    await expect(
      service.selectProfile({
        selection_token: selectionToken,
        profile_id: '22222222-2222-4222-8222-222222222222',
        branch_id: '55555555-5555-4555-8555-555555555555',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('returns current user with active profile data for getMe', async () => {
    const { service, mocks } = createService();
    const userId = '11111111-1111-4111-8111-111111111111';
    const profileId = '22222222-2222-4222-8222-222222222222';
    const now = new Date();

    mocks.userFindFirst.mockResolvedValue({
      id: userId,
      first_name: 'Sara',
      last_name: 'Ali',
      email: 'sara@example.com',
      is_active: true,
      verified_at: now,
      created_at: now,
      profiles: [
        {
          id: profileId,
          job_title: 'Surgeon',
          specialty: 'Orthopedics',
          is_clinical: true,
          organization: {
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Clinic',
            specialities: ['Orthopedics'],
            status: 'ACTIVE',
          },
          roles: [{ role: { id: 'role-1', name: 'OWNER' } }],
          branches: [
            {
              branch: {
                id: 'branch-1',
                address: '123 Main St',
                city: 'Cairo',
                governorate: 'Cairo',
                country: null,
                is_main: true,
              },
            },
          ],
        },
      ],
    });

    const result = await service.getMe(userId, profileId);

    expect(result).toMatchObject({
      id: userId,
      first_name: 'Sara',
      last_name: 'Ali',
      email: 'sara@example.com',
      profiles: [
        {
          staff_id: profileId,
          job_title: 'Surgeon',
          specialty: 'Orthopedics',
          is_clinical: true,
          organization: {
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Clinic',
          },
          roles: [{ id: 'role-1', name: 'OWNER' }],
          branches: [
            {
              id: 'branch-1',
              city: 'Cairo',
              is_main: true,
            },
          ],
        },
      ],
    });
    expect(mocks.userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: userId }),
      }),
    );
  });

  it('throws NotFoundException when user not found in getMe', async () => {
    const { service, mocks } = createService();
    mocks.userFindFirst.mockResolvedValue(null);

    await expect(service.getMe('missing-user', 'any-profile')).rejects.toThrow(
      'User not found',
    );
  });

  it('returns 409 and does not resend OTP when pending user found only by phone collision', async () => {
    const { service, mocks } = createService();
    // Existing PENDING user has a different email but same phone number
    mocks.userFindFirst.mockResolvedValue({
      id: 'other-user-id',
      email: 'other@example.com',
      phone_number: '+201012345678',
      registration_status: 'PENDING',
    });

    await expect(
      service.signupStart({
        first_name: 'Sara',
        last_name: 'Ali',
        email: 'sara@example.com',
        phone_number: '+201012345678',
        password: 'Password1!',
        confirm_password: 'Password1!',
      }),
    ).rejects.toThrow(ConflictException);

    // Must never issue a token or send email for the phone-matched user
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('resumes pending registration only when email matches, ignoring phone', async () => {
    const { service, mocks } = createService();
    const existingUser = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@example.com',
      phone_number: '+201012345678',
      registration_status: 'PENDING',
    };
    // findFirst returns same user twice: once for the existence check, once inside resendOtp
    mocks.userFindFirst
      .mockResolvedValueOnce(existingUser)
      .mockResolvedValueOnce(existingUser);
    mocks.verificationFindFirst.mockResolvedValue(null);
    mocks.verificationCount.mockResolvedValue(0);
    mocks.verificationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.verificationCreate.mockResolvedValue({});

    const result = await service.signupStart({
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
    const accountCreate = jest.fn();
    const txMock = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      organization: { create: accountCreate },
      branch: { create: jest.fn() },
      profile: { create: jest.fn() },
      subscription: { create: jest.fn() },
    };
    const { service, jwtService } = createService({
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
    });

    const signupToken = jwtService.sign(
      { userId: 'user-id', type: 'signup' },
      { secret: 'access-secret' },
    );

    await expect(
      service.signupComplete({
        signup_token: signupToken,
        organization_name: 'Clinic',
        specialties: ['General Medicine'],
        branch_name: 'Main Branch',
        branch_address: '1 Clinic St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
        roles: ['OWNER'],
      }),
    ).rejects.toThrow(ConflictException);

    // Transaction was entered but no account was created
    expect(accountCreate).not.toHaveBeenCalled();
  });
});
