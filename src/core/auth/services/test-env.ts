// Test-only helper. Builds a kitchen-sink Auth-flows environment so individual
// specs can pick the services and mocks they need without rebuilding the wiring.
// Not imported from any production code path.
import { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { EmailService } from '@infrastructure/email/email.service.js';
import type { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import type { EventBus } from '@infrastructure/messaging/event-bus.js';
import { TokensService } from './tokens.service.js';
import { VerificationCodesService } from './verification-codes.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { SignupService } from './signup.service.js';
import { SessionsService } from './sessions.service.js';

export function createAuthTestEnv(
  prismaOverrides: Record<string, unknown> = {},
) {
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
  const branchFindMany = jest.fn();
  const refreshTokenCreate = jest.fn();
  const sendVerificationEmail = jest.fn();
  const getEffectiveBranchIds = jest.fn().mockResolvedValue([]);

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
      branch: { findMany: branchFindMany },
      passwordResetToken: {
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
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
        resetSecret: 'reset-secret',
        accessExpiration: '15m',
        refreshExpiration: '7d',
        registrationExpiration: '30m',
      },
      verificationCodes: {
        otpTtlMinutes: 15,
        otpMaxAttempts: 5,
        otpBcryptRounds: 10,
        resendCooldownSeconds: 60,
        resendMaxPerHour: 5,
      },
      freeTrialDays: 14,
      invitationExpireHours: 72,
      resend: { apiKey: 'key', fromEmail: 'noreply@example.com' },
    }),
  };
  const mailService = {
    sendVerificationEmail,
  } as unknown as EmailService;

  const authorizationService = {
    getEffectiveBranchIds,
  } as unknown as AuthorizationService;

  const publish = jest.fn();
  const eventBus = { publish } as unknown as EventBus;

  const tokensService = new TokensService(
    prismaService,
    jwtService,
    configService as never,
    eventBus,
  );

  const verificationCodesService = new VerificationCodesService(
    prismaService,
    configService as never,
    mailService,
  );

  const passwordResetService = new PasswordResetService(
    prismaService,
    tokensService,
    verificationCodesService,
    eventBus,
  );

  const sessionsService = new SessionsService(
    prismaService,
    authorizationService,
    tokensService,
    eventBus,
  );

  const signupService = new SignupService(
    prismaService,
    configService as never,
    tokensService,
    verificationCodesService,
    sessionsService,
    eventBus,
  );

  return {
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
      branchFindMany,
      refreshTokenCreate,
      sendVerificationEmail,
      getEffectiveBranchIds,
    },
    jwtService,
    tokensService,
    verificationCodesService,
    passwordResetService,
    signupService,
    sessionsService,
    eventBus,
    publish,
  };
}
