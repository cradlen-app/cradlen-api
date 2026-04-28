jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2b$12$mocked-hash'),
  compare: jest.fn(),
}));

import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../../database/prisma.service';
import { createPrismaMock, type PrismaMock } from './test-mocks/prisma.mock';

const AUTH_CONFIG = {
  jwt: {
    accessSecret: 'test-access-secret-at-least-32-chars!!',
    refreshSecret: 'test-refresh-secret-at-least-32!!',
    resetSecret: 'test-reset-secret-at-least-32-chars!!',
    accessExpiration: '15m',
    refreshExpiration: '7d',
    registrationExpiration: '30m',
  },
  resend: { apiKey: 'fake', fromEmail: 'noreply@test.com' },
  freeTrialDays: 14,
};

const MOCK_USER = {
  id: 'user-uuid-1',
  first_name: 'John',
  last_name: 'Doe',
  email: 'john@example.com',
  password_hashed: '$2b$12$hashed',
  is_active: true,
  is_deleted: false,
  verified_at: new Date(),
  registration_status: 'ACTIVE' as const,
  created_at: new Date(),
  deleted_at: null,
};

const MOCK_VERIFICATION = {
  id: 'verif-uuid-1',
  user_id: 'user-uuid-1',
  code_hash: '$2b$06$hashed-otp',
  expires_at: new Date(Date.now() + 15 * 60 * 1000),
  used_at: null,
  created_at: new Date(),
};

const MOCK_REFRESH_TOKEN = {
  id: 'rt-uuid-1',
  jti: 'jti-uuid-1',
  token_hash: '$2b$10$hashed-rt',
  user_id: 'user-uuid-1',
  is_revoked: false,
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  revoked_at: null,
  created_at: new Date(),
  user: MOCK_USER,
};

const MOCK_PENDING_USER = {
  ...MOCK_USER,
  registration_status: 'PENDING' as const,
};

describe('AuthService', () => {
  let service: AuthService;
  let prismaMock: PrismaMock;
  let mailMock: {
    sendVerificationEmail: jest.Mock;
    sendPasswordResetEmail: jest.Mock;
  };

  beforeEach(async () => {
    prismaMock = createPrismaMock();
    mailMock = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        JwtService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: MailService, useValue: mailMock },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'auth' ? AUTH_CONFIG : undefined),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ── registerPersonal ─────────────────────────────────────────────────────────

  describe('registerPersonal', () => {
    const dto = {
      first_name: 'John',
      last_name: 'Doe',
      email: 'john@example.com',
      phone_number: '+201012345678',
      password: 'Password1!',
      confirm_password: 'Password1!',
    };

    it('creates user, sends OTP, returns registration token', async () => {
      prismaMock.db.user.findUnique.mockResolvedValue(null);
      prismaMock.db.$transaction.mockImplementation(
        async (cb: (db: PrismaMock['db']) => Promise<typeof MOCK_USER>) =>
          cb(prismaMock.db),
      );
      prismaMock.db.user.create.mockResolvedValue(MOCK_USER);
      prismaMock.db.profile.create.mockResolvedValue({});
      prismaMock.db.emailVerification.create.mockResolvedValue({});

      const result = await service.registerPersonal(dto);

      expect(prismaMock.db.user.findUnique).toHaveBeenCalledWith({
        where: { email: dto.email },
      });
      expect(prismaMock.db.$transaction).toHaveBeenCalledTimes(1);
      expect(mailMock.sendVerificationEmail).toHaveBeenCalledTimes(1);
      expect(mailMock.sendVerificationEmail).toHaveBeenCalledWith(
        dto.email,
        expect.any(String),
      );
      expect(result).toHaveProperty('registration_token');
      expect(result).toHaveProperty('expires_in', 1800);
    });

    it('throws ConflictException when email is already registered as ACTIVE', async () => {
      prismaMock.db.user.findUnique.mockResolvedValue({
        ...MOCK_USER,
        registration_status: 'ACTIVE',
      });

      await expect(service.registerPersonal(dto)).rejects.toThrow(
        ConflictException,
      );
      expect(prismaMock.db.$transaction).not.toHaveBeenCalled();
    });

    it('throws ConflictException with REGISTRATION_PENDING code when email exists as PENDING', async () => {
      prismaMock.db.user.findUnique.mockResolvedValue({
        ...MOCK_USER,
        registration_status: 'PENDING',
      });

      const error = await service.registerPersonal(dto).catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      const response = error.getResponse() as Record<string, unknown>;
      expect(response['code']).toBe('REGISTRATION_PENDING');
      expect(prismaMock.db.$transaction).not.toHaveBeenCalled();
    });

    it('creates profile with only user_id', async () => {
      prismaMock.db.user.findUnique.mockResolvedValue(null);
      prismaMock.db.$transaction.mockImplementation(
        async (cb: (db: PrismaMock['db']) => Promise<typeof MOCK_USER>) =>
          cb(prismaMock.db),
      );
      prismaMock.db.user.create.mockResolvedValue(MOCK_USER);
      prismaMock.db.profile.create.mockResolvedValue({});
      prismaMock.db.emailVerification.create.mockResolvedValue({});

      const result = await service.registerPersonal(dto);

      expect(prismaMock.db.profile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { user_id: MOCK_USER.id },
        }),
      );
      expect(result).toHaveProperty('registration_token');
    });
  });

  // ── verifyEmail ──────────────────────────────────────────────────────────────

  describe('verifyEmail', () => {
    let registrationToken: string;

    beforeEach(async () => {
      registrationToken = await setupRegistrationToken();
    });

    it('validates OTP, marks verification used, returns new registration token', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(MOCK_PENDING_USER);
      prismaMock.db.emailVerification.findFirst.mockResolvedValue(
        MOCK_VERIFICATION,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prismaMock.db.$transaction.mockResolvedValue([{}, {}]);

      const result = await service.verifyEmail(registrationToken, '123456');

      expect(prismaMock.db.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('registration_token');
    });

    it('throws UnauthorizedException on wrong OTP', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(MOCK_PENDING_USER);
      prismaMock.db.emailVerification.findFirst.mockResolvedValue(
        MOCK_VERIFICATION,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.verifyEmail(registrationToken, '000000'),
      ).rejects.toThrow(new UnauthorizedException('Invalid OTP'));
    });

    it('throws UnauthorizedException when OTP is expired', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(MOCK_PENDING_USER);
      prismaMock.db.emailVerification.findFirst.mockResolvedValue({
        ...MOCK_VERIFICATION,
        expires_at: new Date(Date.now() - 1000),
      });

      await expect(
        service.verifyEmail(registrationToken, '123456'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when no verification record found', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(MOCK_PENDING_USER);
      prismaMock.db.emailVerification.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyEmail(registrationToken, '123456'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for invalid registration token', async () => {
      await expect(
        service.verifyEmail('garbage-token', '123456'),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid or expired registration token'),
      );
    });

    it('throws UnauthorizedException when user not found', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyEmail(registrationToken, '123456'),
      ).rejects.toThrow(new UnauthorizedException('User not found'));
    });
  });

  // ── resendOtp ────────────────────────────────────────────────────────────────

  describe('resendOtp', () => {
    let registrationToken: string;

    beforeEach(async () => {
      registrationToken = await setupRegistrationToken();
    });

    it('sends new OTP when cooldown has elapsed', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(MOCK_PENDING_USER);
      prismaMock.db.emailVerification.count.mockResolvedValue(2);
      prismaMock.db.emailVerification.findFirst.mockResolvedValue({
        ...MOCK_VERIFICATION,
        created_at: new Date(Date.now() - 90 * 1000),
      });
      prismaMock.db.emailVerification.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaMock.db.emailVerification.create.mockResolvedValue({});

      const result = await service.resendOtp(registrationToken);

      expect(mailMock.sendVerificationEmail).toHaveBeenCalledTimes(1);
      expect(prismaMock.db.emailVerification.updateMany).toHaveBeenCalledTimes(
        1,
      );
      expect(result).toHaveProperty('registration_token');
    });

    it('sends OTP when no prior OTPs exist', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(MOCK_PENDING_USER);
      prismaMock.db.emailVerification.count.mockResolvedValue(0);
      prismaMock.db.emailVerification.findFirst.mockResolvedValue(null);
      prismaMock.db.emailVerification.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaMock.db.emailVerification.create.mockResolvedValue({});

      const result = await service.resendOtp(registrationToken);

      expect(mailMock.sendVerificationEmail).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('registration_token');
    });

    it('throws UnauthorizedException when max attempts reached', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(MOCK_PENDING_USER);
      prismaMock.db.emailVerification.count.mockResolvedValue(5);
      prismaMock.db.emailVerification.findFirst.mockResolvedValue(
        MOCK_VERIFICATION,
      );

      await expect(service.resendOtp(registrationToken)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mailMock.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException within cooldown window', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(MOCK_PENDING_USER);
      prismaMock.db.emailVerification.count.mockResolvedValue(1);
      prismaMock.db.emailVerification.findFirst.mockResolvedValue({
        ...MOCK_VERIFICATION,
        created_at: new Date(Date.now() - 30 * 1000),
      });

      await expect(service.resendOtp(registrationToken)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mailMock.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException for invalid token', async () => {
      await expect(service.resendOtp('garbage')).rejects.toThrow(
        new UnauthorizedException('Invalid or expired registration token'),
      );
    });

    it('throws UnauthorizedException when user not found', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(null);

      await expect(service.resendOtp(registrationToken)).rejects.toThrow(
        new UnauthorizedException('User not found'),
      );
    });
  });

  // ── registerOrganization ─────────────────────────────────────────────────────

  describe('registerOrganization', () => {
    const OWNER_ROLE = { id: 'role-uuid-1', name: 'owner' };
    const FREE_PLAN = { id: 'plan-uuid-1', plan: 'free_trial' };
    let dto: {
      registration_token: string;
      organization_name: string;
      branch_address: string;
      branch_city: string;
      branch_governorate: string;
    };

    beforeEach(async () => {
      const token = await setupVerifiedRegistrationToken();
      dto = {
        registration_token: token,
        organization_name: 'Test Clinic',
        branch_address: '123 Main St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
      };
    });

    it('creates org, branch, staff, subscription and returns token pair', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(MOCK_PENDING_USER);
      prismaMock.db.role.findFirst.mockResolvedValue(OWNER_ROLE);
      prismaMock.db.subscriptionPlan.findFirst.mockResolvedValue(FREE_PLAN);
      prismaMock.db.refreshToken.create.mockResolvedValue(MOCK_REFRESH_TOKEN);
      prismaMock.db.$transaction.mockImplementation(
        async (cb: (db: PrismaMock['db']) => Promise<void>) =>
          cb(prismaMock.db),
      );
      prismaMock.db.organization.create.mockResolvedValue({ id: 'org-uuid-1' });
      prismaMock.db.branch.create.mockResolvedValue({ id: 'branch-uuid-1' });
      prismaMock.db.staff.create.mockResolvedValue({});
      prismaMock.db.subscription.create.mockResolvedValue({});

      const result = await service.registerOrganization(dto);

      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result.token_type).toBe('Bearer');
    });

    it('flips user registration_status to ACTIVE inside the transaction', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(MOCK_PENDING_USER);
      prismaMock.db.role.findFirst.mockResolvedValue(OWNER_ROLE);
      prismaMock.db.subscriptionPlan.findFirst.mockResolvedValue(FREE_PLAN);
      prismaMock.db.refreshToken.create.mockResolvedValue(MOCK_REFRESH_TOKEN);
      prismaMock.db.$transaction.mockImplementation(
        async (cb: (db: PrismaMock['db']) => Promise<void>) =>
          cb(prismaMock.db),
      );
      prismaMock.db.organization.create.mockResolvedValue({ id: 'org-uuid-1' });
      prismaMock.db.branch.create.mockResolvedValue({ id: 'branch-uuid-1' });
      prismaMock.db.staff.create.mockResolvedValue({});
      prismaMock.db.subscription.create.mockResolvedValue({});
      prismaMock.db.user.update.mockResolvedValue({
        ...MOCK_USER,
        registration_status: 'ACTIVE',
      });

      await service.registerOrganization(dto);

      expect(prismaMock.db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: MOCK_USER.id },
          data: expect.objectContaining({ registration_status: 'ACTIVE' }),
        }),
      );
    });

    it('throws ForbiddenException when email is not verified', async () => {
      const token = await setupRegistrationToken();
      prismaMock.db.user.findFirst.mockResolvedValue({
        ...MOCK_USER,
        verified_at: null,
      });

      await expect(
        service.registerOrganization({ ...dto, registration_token: token }),
      ).rejects.toThrow(new ForbiddenException('Email not verified'));
    });

    it('throws InternalServerErrorException when owner role not seeded', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(MOCK_PENDING_USER);
      prismaMock.db.role.findFirst.mockResolvedValue(null);
      prismaMock.db.subscriptionPlan.findFirst.mockResolvedValue(FREE_PLAN);

      await expect(service.registerOrganization(dto)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('throws InternalServerErrorException when free trial plan not seeded', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(MOCK_PENDING_USER);
      prismaMock.db.role.findFirst.mockResolvedValue(OWNER_ROLE);
      prismaMock.db.subscriptionPlan.findFirst.mockResolvedValue(null);

      await expect(service.registerOrganization(dto)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('throws UnauthorizedException when user not found', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(null);

      await expect(service.registerOrganization(dto)).rejects.toThrow(
        new UnauthorizedException('User not found'),
      );
    });
  });

  // ── login ────────────────────────────────────────────────────────────────────

  describe('login', () => {
    const dto = { email: 'john@example.com', password: 'Password1!' };

    it('returns token pair for valid credentials', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(MOCK_USER);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prismaMock.db.refreshToken.create.mockResolvedValue(MOCK_REFRESH_TOKEN);

      const result = await service.login(dto);

      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result.token_type).toBe('Bearer');
    });

    it('throws UnauthorizedException when user not found', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
    });

    it('throws UnauthorizedException on wrong password', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue(MOCK_USER);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
    });

    it('throws UnauthorizedException when account is inactive', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue({
        ...MOCK_USER,
        is_active: false,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.login(dto)).rejects.toThrow(
        new UnauthorizedException('Account is inactive'),
      );
    });

    it('returns registration token and pending_step=verify_email for PENDING unverified user', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue({
        ...MOCK_USER,
        registration_status: 'PENDING',
        verified_at: null,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto);

      expect(result).toHaveProperty('registration_token');
      expect(result).toHaveProperty('pending_step', 'verify_email');
      expect(result).not.toHaveProperty('access_token');
    });

    it('returns registration token and pending_step=organization for PENDING verified user', async () => {
      prismaMock.db.user.findFirst.mockResolvedValue({
        ...MOCK_USER,
        registration_status: 'PENDING',
        verified_at: new Date(),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto);

      expect(result).toHaveProperty('registration_token');
      expect(result).toHaveProperty('pending_step', 'organization');
      expect(result).not.toHaveProperty('access_token');
    });
  });

  // ── refresh ──────────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('revokes old token and returns new token pair', async () => {
      prismaMock.db.refreshToken.findUnique.mockResolvedValue(
        MOCK_REFRESH_TOKEN,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prismaMock.db.refreshToken.update.mockResolvedValue({});
      prismaMock.db.refreshToken.create.mockResolvedValue(MOCK_REFRESH_TOKEN);

      const jwtService = new JwtService({});
      const rawToken = jwtService.sign(
        { sub: MOCK_USER.id, jti: MOCK_REFRESH_TOKEN.jti, type: 'refresh' },
        { secret: AUTH_CONFIG.jwt.refreshSecret, expiresIn: '7d' },
      );

      const result = await service.refresh(rawToken);

      expect(prismaMock.db.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ is_revoked: true }),
        }),
      );
      expect(result).toHaveProperty('access_token');
    });

    it('throws UnauthorizedException for revoked token', async () => {
      prismaMock.db.refreshToken.findUnique.mockResolvedValue({
        ...MOCK_REFRESH_TOKEN,
        is_revoked: true,
      });

      const jwtService = new JwtService({});
      const rawToken = jwtService.sign(
        { sub: MOCK_USER.id, jti: MOCK_REFRESH_TOKEN.jti, type: 'refresh' },
        { secret: AUTH_CONFIG.jwt.refreshSecret, expiresIn: '7d' },
      );

      await expect(service.refresh(rawToken)).rejects.toThrow(
        new UnauthorizedException('Refresh token revoked or expired'),
      );
    });

    it('throws UnauthorizedException for token not in DB', async () => {
      prismaMock.db.refreshToken.findUnique.mockResolvedValue(null);

      const jwtService = new JwtService({});
      const rawToken = jwtService.sign(
        { sub: MOCK_USER.id, jti: 'unknown-jti', type: 'refresh' },
        { secret: AUTH_CONFIG.jwt.refreshSecret, expiresIn: '7d' },
      );

      await expect(service.refresh(rawToken)).rejects.toThrow(
        new UnauthorizedException('Refresh token revoked or expired'),
      );
    });

    it('throws UnauthorizedException for expired token in DB', async () => {
      prismaMock.db.refreshToken.findUnique.mockResolvedValue({
        ...MOCK_REFRESH_TOKEN,
        expires_at: new Date(Date.now() - 1000),
      });

      const jwtService = new JwtService({});
      const rawToken = jwtService.sign(
        { sub: MOCK_USER.id, jti: MOCK_REFRESH_TOKEN.jti, type: 'refresh' },
        { secret: AUTH_CONFIG.jwt.refreshSecret, expiresIn: '7d' },
      );

      await expect(service.refresh(rawToken)).rejects.toThrow(
        new UnauthorizedException('Refresh token revoked or expired'),
      );
    });

    it('throws UnauthorizedException on token hash mismatch', async () => {
      prismaMock.db.refreshToken.findUnique.mockResolvedValue(
        MOCK_REFRESH_TOKEN,
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const jwtService = new JwtService({});
      const rawToken = jwtService.sign(
        { sub: MOCK_USER.id, jti: MOCK_REFRESH_TOKEN.jti, type: 'refresh' },
        { secret: AUTH_CONFIG.jwt.refreshSecret, expiresIn: '7d' },
      );

      await expect(service.refresh(rawToken)).rejects.toThrow(
        new UnauthorizedException('Refresh token mismatch'),
      );
    });

    it('throws UnauthorizedException for garbage token', async () => {
      await expect(service.refresh('garbage-token')).rejects.toThrow(
        new UnauthorizedException('Invalid or expired refresh token'),
      );
    });
  });

  // ── logout ───────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('revokes refresh token on valid JWT', async () => {
      prismaMock.db.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const jwtService = new JwtService({});
      const rawToken = jwtService.sign(
        { sub: MOCK_USER.id, jti: 'jti-abc', type: 'refresh' },
        { secret: AUTH_CONFIG.jwt.refreshSecret, expiresIn: '7d' },
      );

      await expect(service.logout(rawToken)).resolves.toBeUndefined();
      expect(prismaMock.db.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ jti: 'jti-abc' }),
        }),
      );
    });

    it('resolves silently on malformed token without calling DB', async () => {
      await expect(service.logout('garbage-token')).resolves.toBeUndefined();
      expect(prismaMock.db.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('revokes even an expired token (ignoreExpiration: true)', async () => {
      prismaMock.db.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const jwtService = new JwtService({});
      const rawToken = jwtService.sign(
        { sub: MOCK_USER.id, jti: 'jti-expired', type: 'refresh' },
        { secret: AUTH_CONFIG.jwt.refreshSecret, expiresIn: '-1s' },
      );

      await expect(service.logout(rawToken)).resolves.toBeUndefined();
      expect(prismaMock.db.refreshToken.updateMany).toHaveBeenCalled();
    });
  });

  // ── getMe ────────────────────────────────────────────────────────────────────

  describe('getMe', () => {
    const MOCK_STAFF_PROFILE = {
      id: 'staff-uuid-1',
      job_title: 'Head Dentist',
      role: { id: 'role-uuid-1', name: 'owner' },
      organization: {
        id: 'org-uuid-1',
        name: 'Cradlen Clinic',
        specialities: ['dentistry'],
        status: 'ACTIVE',
      },
      branch: {
        id: 'branch-uuid-1',
        address: '123 Main St',
        city: 'Cairo',
        governorate: 'Cairo',
        is_main: true,
      },
    };

    it('returns correct user shape with profiles', async () => {
      prismaMock.db.user.findFirstOrThrow.mockResolvedValue({
        ...MOCK_USER,
        staff: [MOCK_STAFF_PROFILE],
      });

      const result = await service.getMe(MOCK_USER.id);

      expect(result).toEqual({
        id: MOCK_USER.id,
        first_name: MOCK_USER.first_name,
        last_name: MOCK_USER.last_name,
        email: MOCK_USER.email,
        is_active: MOCK_USER.is_active,
        verified_at: MOCK_USER.verified_at,
        created_at: MOCK_USER.created_at,
        profiles: [
          {
            staff_id: MOCK_STAFF_PROFILE.id,
            job_title: MOCK_STAFF_PROFILE.job_title,
            role: MOCK_STAFF_PROFILE.role,
            organization: MOCK_STAFF_PROFILE.organization,
            branch: MOCK_STAFF_PROFILE.branch,
          },
        ],
      });
    });

    it('preserves null verified_at for unverified users', async () => {
      prismaMock.db.user.findFirstOrThrow.mockResolvedValue({
        ...MOCK_USER,
        verified_at: null,
        staff: [],
      });

      const result = await service.getMe(MOCK_USER.id);

      expect(result.verified_at).toBeNull();
    });

    it('returns empty profiles when user has no staff records', async () => {
      prismaMock.db.user.findFirstOrThrow.mockResolvedValue({
        ...MOCK_USER,
        staff: [],
      });

      const result = await service.getMe(MOCK_USER.id);

      expect(result.profiles).toEqual([]);
    });
  });

  // ── private helpers ──────────────────────────────────────────────────────────

  async function setupRegistrationToken(): Promise<string> {
    prismaMock.db.user.findUnique.mockResolvedValue(null);
    prismaMock.db.$transaction.mockImplementation(
      async (cb: (db: PrismaMock['db']) => Promise<typeof MOCK_USER>) =>
        cb(prismaMock.db),
    );
    prismaMock.db.user.create.mockResolvedValue(MOCK_USER);
    prismaMock.db.profile.create.mockResolvedValue({});
    prismaMock.db.emailVerification.create.mockResolvedValue({});

    const result = await service.registerPersonal({
      first_name: 'John',
      last_name: 'Doe',
      email: 'john@example.com',
      phone_number: '+201012345678',
      password: 'Password1!',
      confirm_password: 'Password1!',
    });

    jest.clearAllMocks();
    mailMock.sendVerificationEmail.mockResolvedValue(undefined);

    return result.registration_token;
  }

  async function setupVerifiedRegistrationToken(): Promise<string> {
    const token = await setupRegistrationToken();

    prismaMock.db.user.findFirst.mockResolvedValue(MOCK_USER);
    prismaMock.db.emailVerification.findFirst.mockResolvedValue(
      MOCK_VERIFICATION,
    );
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    prismaMock.db.$transaction.mockResolvedValue([{}, {}]);

    const result = await service.verifyEmail(token, '123456');

    jest.clearAllMocks();
    mailMock.sendVerificationEmail.mockResolvedValue(undefined);

    return result.registration_token;
  }
});
