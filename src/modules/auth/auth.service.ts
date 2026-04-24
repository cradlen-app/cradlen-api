import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomInt, randomUUID } from 'crypto';
import type { User } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import type { AuthConfig } from '../../config/auth.config.js';
import type {
  JwtAccessPayload,
  JwtRefreshPayload,
  RegistrationTokenPayload,
} from './interfaces/jwt-payload.interface.js';
import type { RegisterPersonalDto } from './dto/register-personal.dto.js';
import type { RegisterOrganizationDto } from './dto/register-organization.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { AuthTokensDto } from './dto/auth-tokens.dto.js';
import type { RegistrationTokenResponseDto } from './dto/registration-token-response.dto.js';
import type { MeResponseDto } from './dto/me-response.dto.js';

const OTP_TTL_MINUTES = 15;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  private readonly authConfig: AuthConfig;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {
    const config = this.configService.get<AuthConfig>('auth');
    if (!config) throw new Error('Auth configuration not loaded');
    this.authConfig = config;
  }

  // ── Step 1: personal info ──────────────────────────────────────────────────

  async registerPersonal(
    dto: RegisterPersonalDto,
  ): Promise<RegistrationTokenResponseDto> {
    const existing = await this.prismaService.db.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email is already registered');

    if (dto.is_clinical && !dto.speciality) {
      throw new BadRequestException(
        'speciality is required for clinical users',
      );
    }

    const password_hashed = await bcrypt.hash(dto.password, 12);

    const user = await this.prismaService.db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          first_name: dto.first_name,
          last_name: dto.last_name,
          email: dto.email,
          password_hashed,
        },
      });
      await tx.profile.create({
        data: {
          user_id: created.id,
          is_clinical: dto.is_clinical,
          speciality: dto.speciality ?? null,
        },
      });
      return created;
    });

    await this.sendOtp(user.id, user.email);

    return this.issueRegistrationToken(user.id);
  }

  // ── Step 2: email verification ─────────────────────────────────────────────

  async verifyEmail(
    registrationToken: string,
    code: string,
  ): Promise<RegistrationTokenResponseDto> {
    const userId = this.decodeRegistrationToken(registrationToken);

    const user = await this.prismaService.db.user.findFirst({
      where: { id: userId, is_deleted: false },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const verification =
      await this.prismaService.db.emailVerification.findFirst({
        where: { user_id: userId, used_at: null },
        orderBy: { created_at: 'desc' },
      });

    if (!verification || verification.expires_at < new Date()) {
      throw new UnauthorizedException(
        'OTP expired. Please request a new code.',
      );
    }

    const isValid = await bcrypt.compare(code, verification.code_hash);
    if (!isValid) throw new UnauthorizedException('Invalid OTP');

    await this.prismaService.db.$transaction([
      this.prismaService.db.emailVerification.update({
        where: { id: verification.id },
        data: { used_at: new Date() },
      }),
      this.prismaService.db.user.update({
        where: { id: userId },
        data: { verified_at: new Date() },
      }),
    ]);

    return this.issueRegistrationToken(userId);
  }

  // ── Resend OTP ─────────────────────────────────────────────────────────────

  async resendOtp(
    registrationToken: string,
  ): Promise<RegistrationTokenResponseDto> {
    const userId = this.decodeRegistrationToken(registrationToken);

    const user = await this.prismaService.db.user.findFirst({
      where: { id: userId, is_deleted: false },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const windowStart = new Date(Date.now() - 30 * 60 * 1000);

    const [count, latest] = await Promise.all([
      this.prismaService.db.emailVerification.count({
        where: { user_id: userId, created_at: { gte: windowStart } },
      }),
      this.prismaService.db.emailVerification.findFirst({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    if (count >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException(
        'Maximum OTP attempts reached. Please start registration again.',
      );
    }

    if (latest) {
      const secondsAgo = (Date.now() - latest.created_at.getTime()) / 1000;
      if (secondsAgo < OTP_RESEND_COOLDOWN_SECONDS) {
        const waitSeconds = Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsAgo);
        throw new UnauthorizedException(
          `Please wait ${waitSeconds} seconds before requesting a new code.`,
        );
      }
    }

    await this.prismaService.db.emailVerification.updateMany({
      where: { user_id: userId, used_at: null },
      data: { used_at: new Date() },
    });

    await this.sendOtp(userId, user.email);

    return this.issueRegistrationToken(userId);
  }

  // ── Step 3: organization + Start Free Trial ────────────────────────────────

  async registerOrganization(
    dto: RegisterOrganizationDto,
  ): Promise<AuthTokensDto> {
    const userId = this.decodeRegistrationToken(dto.registration_token);

    const user = await this.prismaService.db.user.findFirst({
      where: { id: userId, is_deleted: false },
    });
    if (!user) throw new UnauthorizedException('User not found');
    if (!user.verified_at) throw new ForbiddenException('Email not verified');

    const [ownerRole, freePlan] = await Promise.all([
      this.prismaService.db.role.findFirst({ where: { name: 'owner' } }),
      this.prismaService.db.subscriptionPlan.findFirst({
        where: { plan: 'free_trial' },
      }),
    ]);

    if (!ownerRole)
      throw new InternalServerErrorException('Owner role not seeded');
    if (!freePlan)
      throw new InternalServerErrorException('Free trial plan not seeded');

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + this.authConfig.freeTrialDays);

    await this.prismaService.db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: dto.organization_name,
          specialities: dto.organization_specialities ?? [],
          status: 'active',
        },
      });

      const branch = await tx.branch.create({
        data: {
          address: dto.branch_address,
          city: dto.branch_city,
          governate: dto.branch_governate,
          is_main: true,
          status: 'active',
          organization_id: org.id,
        },
      });

      await tx.staff.create({
        data: {
          user_id: user.id,
          organization_id: org.id,
          branch_id: branch.id,
          role_id: ownerRole.id,
        },
      });

      await tx.subscription.create({
        data: {
          organization_id: org.id,
          subscription_plan_id: freePlan.id,
          trial_ends_at: trialEndsAt,
        },
      });
    });

    return this.issueTokenPair(user);
  }

  // ── Login ──────────────────────────────────────────────────────────────────

  async login(dto: LoginDto): Promise<AuthTokensDto> {
    const user = await this.prismaService.db.user.findFirst({
      where: { email: dto.email, is_deleted: false },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.password_hashed))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.is_active) throw new UnauthorizedException('Account is inactive');

    return this.issueTokenPair(user);
  }

  // ── Refresh ────────────────────────────────────────────────────────────────

  async refresh(rawRefreshToken: string): Promise<AuthTokensDto> {
    let payload: JwtRefreshPayload;
    try {
      payload = this.jwtService.verify<JwtRefreshPayload>(rawRefreshToken, {
        secret: this.authConfig.jwt.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const stored = await this.prismaService.db.refreshToken.findUnique({
      where: { jti: payload.jti },
      include: { user: true },
    });

    if (!stored || stored.is_revoked || stored.expires_at < new Date()) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    const valid = await bcrypt.compare(rawRefreshToken, stored.token_hash);
    if (!valid) throw new UnauthorizedException('Refresh token mismatch');

    await this.prismaService.db.refreshToken.update({
      where: { id: stored.id },
      data: { is_revoked: true, revoked_at: new Date() },
    });

    return this.issueTokenPair(stored.user);
  }

  // ── Logout ─────────────────────────────────────────────────────────────────

  async logout(rawRefreshToken: string): Promise<void> {
    let payload: JwtRefreshPayload;
    try {
      payload = this.jwtService.verify<JwtRefreshPayload>(rawRefreshToken, {
        secret: this.authConfig.jwt.refreshSecret,
        ignoreExpiration: true,
      });
    } catch {
      return;
    }

    await this.prismaService.db.refreshToken.updateMany({
      where: { jti: payload.jti, is_revoked: false },
      data: { is_revoked: true, revoked_at: new Date() },
    });
  }

  // ── Me ─────────────────────────────────────────────────────────────────────

  getMe(user: User): MeResponseDto {
    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      is_active: user.is_active,
      verified_at: user.verified_at,
      created_at: user.created_at,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async sendOtp(userId: string, email: string): Promise<void> {
    const code = randomInt(100000, 1000000).toString();
    const code_hash = await bcrypt.hash(code, 6);
    const expires_at = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.prismaService.db.emailVerification.create({
      data: { user_id: userId, code_hash, expires_at },
    });

    await this.mailService.sendVerificationEmail(email, code);
  }

  private issueRegistrationToken(userId: string): RegistrationTokenResponseDto {
    const payload: RegistrationTokenPayload = {
      sub: userId,
      type: 'registration',
    };
    const registration_token = this.jwtService.sign(payload, {
      secret: this.authConfig.jwt.accessSecret,
      expiresIn: this.parseDurationToSeconds(
        this.authConfig.jwt.registrationExpiration,
      ),
    });
    return {
      registration_token,
      expires_in: this.parseDurationToSeconds(
        this.authConfig.jwt.registrationExpiration,
      ),
    };
  }

  private decodeRegistrationToken(token: string): string {
    let payload: RegistrationTokenPayload;
    try {
      payload = this.jwtService.verify<RegistrationTokenPayload>(token, {
        secret: this.authConfig.jwt.accessSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired registration token');
    }
    if (payload.type !== 'registration') {
      throw new UnauthorizedException('Invalid token type');
    }
    return payload.sub;
  }

  private async issueTokenPair(user: User): Promise<AuthTokensDto> {
    const jti = randomUUID();
    const accessPayload: JwtAccessPayload = { sub: user.id, email: user.email };
    const refreshPayload: JwtRefreshPayload = { sub: user.id, jti };

    const access_token = this.jwtService.sign(accessPayload, {
      secret: this.authConfig.jwt.accessSecret,
      expiresIn: this.parseDurationToSeconds(
        this.authConfig.jwt.accessExpiration,
      ),
    });

    const refresh_token = this.jwtService.sign(refreshPayload, {
      secret: this.authConfig.jwt.refreshSecret,
      expiresIn: this.parseDurationToSeconds(
        this.authConfig.jwt.refreshExpiration,
      ),
    });

    const token_hash = await bcrypt.hash(refresh_token, 10);
    const expires_at = new Date(
      Date.now() +
        this.parseDurationToSeconds(this.authConfig.jwt.refreshExpiration) *
          1000,
    );

    await this.prismaService.db.refreshToken.create({
      data: { jti, token_hash, user_id: user.id, expires_at },
    });

    return {
      access_token,
      refresh_token,
      token_type: 'Bearer',
      expires_in: this.parseDurationToSeconds(
        this.authConfig.jwt.accessExpiration,
      ),
    };
  }

  private parseDurationToSeconds(duration: string): number {
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match) return 900;
    const value = parseInt(match[1], 10);
    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };
    return value * (multipliers[match[2]] ?? 1);
  }
}
