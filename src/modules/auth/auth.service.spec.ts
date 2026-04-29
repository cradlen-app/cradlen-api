import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
  const sendVerificationEmail = jest.fn();
  const sendPhoneOtp = jest.fn();

  const prismaService = {
    db: {
      user: {
        findFirst: userFindFirst,
        create: userCreate,
        update: userUpdate,
      },
      verificationCode: {
        updateMany: verificationUpdateMany,
        create: verificationCreate,
        findFirst: verificationFindFirst,
        update: verificationUpdate,
      },
      role: { findUnique: jest.fn() },
      subscriptionPlan: { findUnique: jest.fn() },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      profile: { findMany: jest.fn(), findFirst: jest.fn() },
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
    sendPhoneOtp,
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
      verificationUpdateMany,
      verificationCreate,
      sendVerificationEmail,
    },
  };
}

describe('AuthService', () => {
  it('rejects signup start when email already exists', async () => {
    const { service, mocks } = createService();
    mocks.userFindFirst.mockResolvedValue({ id: 'existing-user' });

    await expect(
      service.signupStart({
        first_name: 'Sara',
        last_name: 'Ali',
        email: 'sara@example.com',
        password: 'Password1!',
      }),
    ).rejects.toThrow(ConflictException);
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
      password: 'Password1!',
    });

    expect(result.signup_token).toEqual(expect.any(String));
    expect(mocks.userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          registration_status: 'PENDING',
          onboarding_completed: false,
        }),
      }),
    );
    expect(mocks.sendVerificationEmail).toHaveBeenCalled();
  });

  it('rejects unknown phone OTP requests', async () => {
    const { service, mocks } = createService();
    mocks.userFindFirst.mockResolvedValue(null);

    await expect(
      service.requestPhoneOtp({ phone_number: '+201012345678' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
