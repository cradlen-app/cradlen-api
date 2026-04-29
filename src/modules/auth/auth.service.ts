import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
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
import type { AuthTokensDto } from './dto/auth-tokens.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RefreshDto } from './dto/refresh.dto.js';
import type { SignupCompleteDto } from './dto/signup-complete.dto.js';
import type { SignupStartDto } from './dto/signup-start.dto.js';
import type { SignupVerifyDto } from './dto/signup-verify.dto.js';
import type {
  RequestPhoneOtpDto,
  VerifyPhoneOtpDto,
} from './dto/phone-otp.dto.js';
import type { SelectProfileDto } from './dto/select-profile.dto.js';
import type {
  JwtAccessPayload,
  JwtRefreshPayload,
  SignupTokenPayload,
} from './interfaces/jwt-payload.interface.js';

const OTP_TTL_MINUTES = 15;
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

  async signupStart(dto: SignupStartDto) {
    const existing = await this.prismaService.db.user.findFirst({
      where: {
        OR: [
          { email: dto.email },
          ...(dto.phone_number ? [{ phone_number: dto.phone_number }] : []),
        ],
        is_deleted: false,
      },
    });
    if (existing) throw new ConflictException('User already exists');

    const password_hashed = await bcrypt.hash(dto.password, 12);
    const user = await this.prismaService.db.user.create({
      data: {
        first_name: dto.first_name,
        last_name: dto.last_name,
        email: dto.email,
        phone_number: dto.phone_number,
        password_hashed,
        registration_status: 'PENDING',
        onboarding_completed: false,
      },
    });

    await this.sendVerificationCode({
      userId: user.id,
      target: dto.email,
      channel: 'EMAIL',
      purpose: 'SIGNUP',
    });

    return this.issueSignupToken(user.id, 'signup');
  }

  async signupVerify(dto: SignupVerifyDto) {
    const userId = this.decodeSignupToken(dto.signup_token, 'signup');
    const user = await this.prismaService.db.user.findFirst({
      where: { id: userId, is_deleted: false },
    });
    if (!user?.email) throw new UnauthorizedException('User not found');

    await this.consumeVerificationCode({
      userId,
      target: user.email,
      purpose: 'SIGNUP',
      code: dto.code,
    });

    await this.prismaService.db.user.update({
      where: { id: userId },
      data: {
        verified_at: new Date(),
        registration_status: 'ACTIVE',
        is_active: true,
      },
    });

    return this.issueSignupToken(userId, 'signup');
  }

  async signupComplete(dto: SignupCompleteDto): Promise<AuthTokensDto> {
    const userId = this.decodeSignupToken(dto.signup_token, 'signup');
    const user = await this.prismaService.db.user.findFirst({
      where: { id: userId, is_deleted: false, is_active: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.registration_status !== 'ACTIVE' || !user.verified_at) {
      throw new ForbiddenException('Signup has not been verified');
    }
    if (user.onboarding_completed) {
      throw new ConflictException('Onboarding already completed');
    }
    if (dto.is_clinical && !dto.specialty) {
      throw new BadRequestException('specialty is required for clinical users');
    }

    const [ownerRole, doctorRole, freePlan] = await Promise.all([
      this.findRole('OWNER'),
      dto.is_clinical ? this.findRole('DOCTOR') : Promise.resolve(null),
      this.prismaService.db.subscriptionPlan.findUnique({
        where: { plan: 'free_trial' },
      }),
    ]);
    if (!freePlan)
      throw new InternalServerErrorException('Free trial plan not seeded');

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + this.authConfig.freeTrialDays);

    const result = await this.prismaService.db.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          name: dto.account_name,
          specialities: dto.account_specialities ?? [],
        },
      });
      const branch = await tx.branch.create({
        data: {
          account_id: account.id,
          name: dto.branch_name,
          address: dto.branch_address,
          city: dto.branch_city,
          governorate: dto.branch_governorate,
          country: dto.branch_country,
          is_main: true,
        },
      });
      const profile = await tx.profile.create({
        data: {
          user_id: user.id,
          account_id: account.id,
          is_clinical: dto.is_clinical,
          specialty: dto.specialty,
          job_title: dto.job_title,
          roles: {
            create: [
              { role_id: ownerRole.id },
              ...(doctorRole ? [{ role_id: doctorRole.id }] : []),
            ],
          },
          branches: {
            create: { branch_id: branch.id, account_id: account.id },
          },
        },
      });
      await tx.subscription.create({
        data: {
          account_id: account.id,
          subscription_plan_id: freePlan.id,
          trial_ends_at: trialEndsAt,
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { onboarding_completed: true },
      });
      return { accountId: account.id, profileId: profile.id };
    });

    return this.issueTokenPair(user, result.profileId, result.accountId);
  }

  async login(dto: LoginDto) {
    const user = await this.prismaService.db.user.findFirst({
      where: { email: dto.email, is_deleted: false },
    });
    if (!user?.password_hashed)
      throw new UnauthorizedException('Invalid credentials');
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.password_hashed,
    );
    if (!passwordMatches)
      throw new UnauthorizedException('Invalid credentials');
    return this.buildLoginResponse(user);
  }

  async requestPhoneOtp(dto: RequestPhoneOtpDto) {
    const user = await this.prismaService.db.user.findFirst({
      where: {
        phone_number: dto.phone_number,
        is_deleted: false,
        is_active: true,
      },
    });
    if (!user) throw new UnauthorizedException('User not found');

    await this.sendVerificationCode({
      userId: user.id,
      target: dto.phone_number,
      channel: 'PHONE',
      purpose: 'PHONE_LOGIN',
    });

    return { message: 'OTP sent' };
  }

  async verifyPhoneOtp(dto: VerifyPhoneOtpDto) {
    const user = await this.prismaService.db.user.findFirst({
      where: {
        phone_number: dto.phone_number,
        is_deleted: false,
        is_active: true,
      },
    });
    if (!user) throw new UnauthorizedException('User not found');

    await this.consumeVerificationCode({
      userId: user.id,
      target: dto.phone_number,
      purpose: 'PHONE_LOGIN',
      code: dto.code,
    });

    return this.buildLoginResponse(user);
  }

  async selectProfile(dto: SelectProfileDto): Promise<AuthTokensDto> {
    const userId = this.decodeSignupToken(
      dto.selection_token,
      'profile_selection',
    );
    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        id: dto.profile_id,
        user_id: userId,
        is_deleted: false,
        is_active: true,
        account: { status: 'ACTIVE', is_deleted: false },
      },
      include: { user: true },
    });
    if (!profile) throw new ForbiddenException('Invalid profile selection');
    return this.issueTokenPair(profile.user, profile.id, profile.account_id);
  }

  async refresh(dto: RefreshDto): Promise<AuthTokensDto> {
    let payload: JwtRefreshPayload;
    try {
      payload = this.jwtService.verify<JwtRefreshPayload>(dto.refresh_token, {
        secret: this.authConfig.jwt.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.type !== 'refresh')
      throw new UnauthorizedException('Invalid token type');

    const stored = await this.prismaService.db.refreshToken.findUnique({
      where: { jti: payload.jti },
      include: { user: true },
    });
    if (!stored || stored.is_revoked || stored.expires_at < new Date()) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }
    const matches = await bcrypt.compare(dto.refresh_token, stored.token_hash);
    if (!matches) throw new UnauthorizedException('Refresh token mismatch');
    if (!stored.profile_id || !stored.account_id) {
      throw new UnauthorizedException('Refresh token has no profile context');
    }

    await this.prismaService.db.refreshToken.update({
      where: { id: stored.id },
      data: { is_revoked: true, revoked_at: new Date() },
    });

    return this.issueTokenPair(
      stored.user,
      stored.profile_id,
      stored.account_id,
    );
  }

  async logout(rawRefreshToken: string): Promise<void> {
    try {
      const payload = this.jwtService.verify<JwtRefreshPayload>(
        rawRefreshToken,
        {
          secret: this.authConfig.jwt.refreshSecret,
          ignoreExpiration: true,
        },
      );
      if (payload.type !== 'refresh') return;
      await this.prismaService.db.refreshToken.updateMany({
        where: { jti: payload.jti, is_revoked: false },
        data: { is_revoked: true, revoked_at: new Date() },
      });
    } catch {
      return;
    }
  }

  private async buildLoginResponse(user: User) {
    if (!user.is_active) throw new UnauthorizedException('User is inactive');
    if (user.registration_status !== 'ACTIVE') {
      throw new ForbiddenException('User registration is not active');
    }
    if (!user.onboarding_completed) {
      return {
        type: 'onboarding_required',
        ...this.issueSignupToken(user.id, 'signup'),
      };
    }

    const profiles = await this.getSelectableProfiles(user.id);
    return {
      type: 'profile_selection',
      selection_token: this.issueSignupToken(user.id, 'profile_selection')
        .signup_token,
      profiles,
    };
  }

  private async getSelectableProfiles(userId: string) {
    const profiles = await this.prismaService.db.profile.findMany({
      where: {
        user_id: userId,
        is_deleted: false,
        is_active: true,
        account: { is_deleted: false, status: 'ACTIVE' },
      },
      include: {
        account: true,
        roles: { include: { role: true } },
        branches: { include: { branch: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    return profiles.map((profile) => ({
      id: profile.id,
      account: {
        id: profile.account.id,
        name: profile.account.name,
        specialities: profile.account.specialities,
        status: profile.account.status,
      },
      roles: profile.roles.map((item) => item.role.name),
      branches: profile.branches.map((item) => ({
        id: item.branch.id,
        name: item.branch.name,
        city: item.branch.city,
        governorate: item.branch.governorate,
        is_main: item.branch.is_main,
      })),
    }));
  }

  private async sendVerificationCode(input: {
    userId: string;
    target: string;
    channel: 'EMAIL' | 'PHONE';
    purpose: 'SIGNUP' | 'PHONE_LOGIN' | 'PASSWORD_RESET';
  }) {
    await this.prismaService.db.verificationCode.updateMany({
      where: {
        user_id: input.userId,
        purpose: input.purpose,
        consumed_at: null,
      },
      data: { consumed_at: new Date() },
    });

    const code = randomInt(100000, 1000000).toString();
    const code_hash = await bcrypt.hash(code, 10);
    const expires_at = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    await this.prismaService.db.verificationCode.create({
      data: {
        user_id: input.userId,
        target: input.target,
        channel: input.channel,
        purpose: input.purpose,
        code_hash,
        expires_at,
        max_attempts: OTP_MAX_ATTEMPTS,
      },
    });

    if (input.channel === 'EMAIL') {
      await this.mailService.sendVerificationEmail(input.target, code);
    } else {
      await this.mailService.sendPhoneOtp(input.target, code);
    }
  }

  private async consumeVerificationCode(input: {
    userId: string;
    target: string;
    purpose: 'SIGNUP' | 'PHONE_LOGIN' | 'PASSWORD_RESET';
    code: string;
  }) {
    const record = await this.prismaService.db.verificationCode.findFirst({
      where: {
        user_id: input.userId,
        target: input.target,
        purpose: input.purpose,
        consumed_at: null,
      },
      orderBy: { created_at: 'desc' },
    });
    if (!record) throw new UnauthorizedException('Invalid verification code');
    if (record.expires_at < new Date())
      throw new GoneException('Verification code expired');
    if (record.attempts >= record.max_attempts) {
      throw new UnauthorizedException('Maximum verification attempts reached');
    }

    const matches = await bcrypt.compare(input.code, record.code_hash);
    if (!matches) {
      await this.prismaService.db.verificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid verification code');
    }

    await this.prismaService.db.verificationCode.update({
      where: { id: record.id },
      data: { consumed_at: new Date() },
    });
  }

  private async findRole(name: string) {
    const role = await this.prismaService.db.role.findUnique({
      where: { name },
    });
    if (!role)
      throw new InternalServerErrorException(`${name} role not seeded`);
    return role;
  }

  private issueSignupToken(
    userId: string,
    type: 'signup' | 'profile_selection',
  ) {
    const payload: SignupTokenPayload = { userId, type };
    const signup_token = this.jwtService.sign(payload, {
      secret: this.authConfig.jwt.accessSecret,
      expiresIn: this.parseDurationToSeconds(
        this.authConfig.jwt.registrationExpiration,
      ),
    });
    return {
      signup_token,
      expires_in: this.parseDurationToSeconds(
        this.authConfig.jwt.registrationExpiration,
      ),
    };
  }

  private decodeSignupToken(
    token: string,
    type: 'signup' | 'profile_selection',
  ) {
    let payload: SignupTokenPayload;
    try {
      payload = this.jwtService.verify<SignupTokenPayload>(token, {
        secret: this.authConfig.jwt.accessSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.type !== type)
      throw new UnauthorizedException('Invalid token type');
    return payload.userId;
  }

  private async issueTokenPair(
    user: Pick<User, 'id'>,
    profileId: string,
    accountId: string,
  ): Promise<AuthTokensDto> {
    await this.assertProfileBelongsToUser(user.id, profileId, accountId);

    const jti = randomUUID();
    const accessExpiresIn = this.parseDurationToSeconds(
      this.authConfig.jwt.accessExpiration,
    );
    const refreshExpiresIn = this.parseDurationToSeconds(
      this.authConfig.jwt.refreshExpiration,
    );
    const accessPayload: JwtAccessPayload = {
      userId: user.id,
      profileId,
      accountId,
      type: 'access',
    };
    const refreshPayload: JwtRefreshPayload = {
      userId: user.id,
      profileId,
      accountId,
      jti,
      type: 'refresh',
    };
    const access_token = this.jwtService.sign(accessPayload, {
      secret: this.authConfig.jwt.accessSecret,
      expiresIn: accessExpiresIn,
    });
    const refresh_token = this.jwtService.sign(refreshPayload, {
      secret: this.authConfig.jwt.refreshSecret,
      expiresIn: refreshExpiresIn,
    });
    const token_hash = await bcrypt.hash(refresh_token, 10);
    await this.prismaService.db.refreshToken.create({
      data: {
        jti,
        token_hash,
        user_id: user.id,
        profile_id: profileId,
        account_id: accountId,
        expires_at: new Date(Date.now() + refreshExpiresIn * 1000),
      },
    });

    return {
      type: 'tokens',
      access_token,
      refresh_token,
      token_type: 'Bearer',
      expires_in: accessExpiresIn,
    };
  }

  private async assertProfileBelongsToUser(
    userId: string,
    profileId: string,
    accountId: string,
  ) {
    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        id: profileId,
        user_id: userId,
        account_id: accountId,
        is_deleted: false,
        is_active: true,
      },
      select: { id: true },
    });
    if (!profile) throw new ForbiddenException('Invalid profile context');
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
