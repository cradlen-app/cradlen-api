import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ERROR_CODES } from '../../common/constant/error-codes.js';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomInt, randomUUID } from 'crypto';
import type { User, VerificationPurpose } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import type { AuthConfig } from '../../config/auth.config.js';
import type { AuthTokensDto } from './dto/auth-tokens.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RefreshDto } from './dto/refresh.dto.js';
import type { RegistrationStep } from './dto/registration-status-response.dto.js';
import type { ResendOtpDto } from './dto/resend-otp.dto.js';
import type { SignupCompleteDto } from './dto/signup-complete.dto.js';
import type { SignupStartDto } from './dto/signup-start.dto.js';
import type { SignupVerifyDto } from './dto/signup-verify.dto.js';
import type { SelectProfileDto } from './dto/select-profile.dto.js';
import type {
  JwtAccessPayload,
  JwtRefreshPayload,
  PasswordResetTokenPayload,
  SignupTokenPayload,
} from './interfaces/jwt-payload.interface.js';
import type { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import type { VerifyResetCodeDto } from './dto/verify-reset-code.dto.js';
import type { ResetPasswordDto } from './dto/reset-password.dto.js';
import type { ResetTokenResponseDto } from './dto/reset-token-response.dto.js';
import type { ResendResetCodeDto } from './dto/resend-reset-code.dto.js';
import type { SwitchBranchDto } from './dto/switch-branch.dto.js';
import type { AuthContext } from '../../common/interfaces/auth-context.interface.js';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';

const BCRYPT_ROUNDS = 12;
const OTP_TTL_MINUTES = 15;
const OTP_MAX_ATTEMPTS = 5;
const SIGNUP_RESEND_COOLDOWN_SECONDS = 60;
const SIGNUP_RESEND_MAX_PER_HOUR = 5;
const SIGNUP_COMPLETE_ROLES = ['OWNER', 'DOCTOR'] as const;

type SignupCompleteRole = (typeof SIGNUP_COMPLETE_ROLES)[number];
type VerificationPurposeInput =
  | 'SIGNUP'
  | 'LOGIN'
  | 'PHONE_LOGIN'
  | 'PASSWORD_RESET';
type VerificationPurposeFilter =
  | VerificationPurpose
  | { in: VerificationPurpose[] };

export interface SelectableProfile {
  profile_id: string;
  account_id: string;
  account_name: string;
  roles: string[];
  branches: {
    branch_id: string;
    name: string;
    is_main: boolean;
  }[];
}

export interface ProfileSelectionResponse {
  type: 'profile_selection';
  selection_token: string;
  profiles: SelectableProfile[];
}

export interface OnboardingRequiredResponse {
  type: 'ONBOARDING_REQUIRED';
  step: 'VERIFY_OTP' | 'COMPLETE_ONBOARDING';
}

@Injectable()
export class AuthService {
  private readonly authConfig: AuthConfig;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly authorizationService: AuthorizationService,
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
    if (existing) {
      // Only resume a pending registration when the submitted email matches.
      // A phone-only collision (different email) must never issue a token for
      // the matched user — treat it the same as any other conflict.
      if (
        existing.registration_status === 'PENDING' &&
        existing.email === dto.email
      ) {
        try {
          await this.resendOtp({ email: existing.email });
        } catch {
          // swallow rate-limit errors — caller gets token regardless
        }
        return this.issueSignupToken(existing.id, 'signup');
      }
      const conflictFields = [
        ...(existing.email === dto.email ? ['email'] : []),
        ...(dto.phone_number && existing.phone_number === dto.phone_number
          ? ['phone_number']
          : []),
      ];
      throw new ConflictException({
        message: 'User already exists',
        code: ERROR_CODES.CONFLICT,
        details: { fields: conflictFields },
      });
    }

    const password_hashed = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
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
    if (user.registration_status !== 'PENDING') {
      throw new ConflictException('Email already verified');
    }

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

  async signupComplete(
    dto: SignupCompleteDto,
  ): Promise<ProfileSelectionResponse> {
    const userId = this.decodeSignupToken(dto.signup_token, 'signup');
    const user = await this.prismaService.db.user.findFirst({
      where: { id: userId, is_deleted: false, is_active: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.registration_status !== 'ACTIVE' || !user.verified_at) {
      throw new ForbiddenException('Signup has not been verified');
    }

    const requestedRoles = this.resolveSignupCompleteRoles(dto.roles);
    const isDoctor = requestedRoles.includes('DOCTOR');
    if (isDoctor && (!dto.specialty?.trim() || !dto.job_title?.trim())) {
      throw new BadRequestException(
        'specialty and job_title are required when DOCTOR role is selected',
      );
    }

    const [roles, freePlan] = await Promise.all([
      Promise.all(requestedRoles.map((role) => this.findRole(role))),
      this.prismaService.db.subscriptionPlan.findUnique({
        where: { plan: 'free_trial' },
      }),
    ]);
    if (!freePlan)
      throw new InternalServerErrorException('Free trial plan not seeded');

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + this.authConfig.freeTrialDays);

    const result = await this.prismaService.db.$transaction(async (tx) => {
      // Atomically claim onboarding. If another concurrent request already
      // claimed it, updateMany returns count=0 and we abort before creating
      // any tenant records, preventing duplicate account/profile/subscription.
      const claimed = await tx.user.updateMany({
        where: {
          id: userId,
          registration_status: 'ACTIVE',
          verified_at: { not: null },
          onboarding_completed: false,
        },
        data: { onboarding_completed: true },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Onboarding already completed');
      }

      const account = await tx.account.create({
        data: {
          name: dto.account_name,
          specialities: dto.specialties,
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
          user_id: userId,
          account_id: account.id,
          is_clinical: isDoctor,
          specialty: isDoctor ? dto.specialty : null,
          job_title: isDoctor ? dto.job_title : null,
          roles: {
            create: roles.map((role) => ({ role_id: role.id })),
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
      return { accountId: account.id, profileId: profile.id, userId };
    });

    return this.buildProfileSelectionResponse(result.userId);
  }

  async resendOtp(dto: ResendOtpDto) {
    const user = await this.prismaService.db.user.findFirst({
      where: { email: dto.email, is_deleted: false },
    });
    if (!user) return { success: true as const };
    if (user.registration_status !== 'PENDING') {
      throw new ConflictException('Registration is not pending');
    }

    const latestResend = await this.prismaService.db.verificationCode.findFirst(
      {
        where: {
          user_id: user.id,
          purpose: 'SIGNUP',
          is_resend: true,
        },
        orderBy: { created_at: 'desc' },
      },
    );
    if (
      latestResend &&
      latestResend.created_at.getTime() >
        Date.now() - SIGNUP_RESEND_COOLDOWN_SECONDS * 1000
    ) {
      throw new HttpException(
        'Please wait before requesting another code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const resendWindowStart = new Date(Date.now() - 60 * 60 * 1000);
    const recentResendCount =
      await this.prismaService.db.verificationCode.count({
        where: {
          user_id: user.id,
          purpose: 'SIGNUP',
          is_resend: true,
          created_at: { gte: resendWindowStart },
        },
      });
    if (recentResendCount >= SIGNUP_RESEND_MAX_PER_HOUR) {
      throw new HttpException(
        'Too many resend requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.sendVerificationCode({
      userId: user.id,
      target: dto.email,
      channel: 'EMAIL',
      purpose: 'SIGNUP',
      isResend: true,
    });

    return { success: true as const };
  }

  async getRegistrationStatus(input: {
    email?: string;
    authorization?: string;
  }): Promise<{ step: RegistrationStep; email?: string }> {
    const tokenUserId = this.tryDecodeAccessToken(input.authorization);
    if (tokenUserId) {
      const user = await this.prismaService.db.user.findFirst({
        where: { id: tokenUserId, is_deleted: false },
      });
      if (!user) return { step: 'NONE' };
      return {
        step: this.resolveRegistrationStep(user),
        ...(user.email ? { email: user.email } : {}),
      };
    }

    if (!input.email) {
      if (input.authorization) {
        throw new UnauthorizedException('Invalid or expired token');
      }
      throw new BadRequestException('email is required');
    }

    const user = await this.prismaService.db.user.findFirst({
      where: { email: input.email, is_deleted: false },
    });
    if (!user) return { step: 'NONE' };
    return { step: this.resolveRegistrationStep(user) };
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
      include: {
        user: true,
        branches: {
          where: {
            branch: { status: 'ACTIVE', is_deleted: false },
          },
          include: { branch: true },
          orderBy: { created_at: 'asc' },
        },
      },
    });
    if (!profile) throw new ForbiddenException('Invalid profile selection');

    const branchId = this.resolveSelectedBranchId(
      profile.branches,
      dto.branch_id,
    );

    const selectedBranch = profile.branches.find(
      (item) => item.branch_id === branchId,
    );
    if (!selectedBranch || selectedBranch.account_id !== profile.account_id) {
      throw new ForbiddenException('Invalid branch selection');
    }

    return this.issueTokenPair(
      profile.user,
      profile.id,
      profile.account_id,
      branchId,
    );
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
      stored.active_branch_id ?? undefined,
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

  async switchBranch(
    user: AuthContext,
    dto: SwitchBranchDto,
  ): Promise<AuthTokensDto> {
    const canAccess = await this.authorizationService.canAccessBranch(
      user.profileId,
      dto.branch_id,
    );
    if (!canAccess) throw new ForbiddenException('Branch access denied');

    return this.issueTokenPair(
      { id: user.userId },
      user.profileId,
      user.accountId,
      dto.branch_id,
    );
  }

  private async buildLoginResponse(
    user: User,
  ): Promise<ProfileSelectionResponse | OnboardingRequiredResponse> {
    if (!user.is_active) throw new UnauthorizedException('User is inactive');
    if (user.registration_status === 'PENDING') {
      return {
        type: 'ONBOARDING_REQUIRED',
        step: 'VERIFY_OTP',
      };
    }
    if (user.registration_status !== 'ACTIVE') {
      throw new ForbiddenException('User registration is not active');
    }
    if (!user.onboarding_completed) {
      return {
        type: 'ONBOARDING_REQUIRED',
        step: 'COMPLETE_ONBOARDING',
      };
    }

    return this.buildProfileSelectionResponse(user.id);
  }

  private async buildProfileSelectionResponse(
    userId: string,
  ): Promise<ProfileSelectionResponse> {
    const profiles = await this.getSelectableProfiles(userId);
    return {
      type: 'profile_selection',
      selection_token: this.issueSignupToken(userId, 'profile_selection')
        .signup_token,
      profiles,
    };
  }

  private async getSelectableProfiles(
    userId: string,
  ): Promise<SelectableProfile[]> {
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
        branches: {
          where: {
            branch: { status: 'ACTIVE', is_deleted: false },
          },
          include: { branch: true },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    return profiles.map((profile) => ({
      profile_id: profile.id,
      account_id: profile.account.id,
      account_name: profile.account.name,
      roles: profile.roles.map((item) => item.role.name),
      branches: profile.branches.map((item) => ({
        branch_id: item.branch.id,
        name: item.branch.name,
        is_main: item.branch.is_main,
      })),
    }));
  }

  private resolveSignupCompleteRoles(roles: string[]): SignupCompleteRole[] {
    const uniqueRoles = [...new Set(roles)] as SignupCompleteRole[];
    const unsupportedRole = uniqueRoles.find(
      (role) => !SIGNUP_COMPLETE_ROLES.includes(role),
    );
    if (unsupportedRole) {
      throw new BadRequestException(`Unsupported role: ${unsupportedRole}`);
    }
    if (!uniqueRoles.includes('OWNER')) {
      throw new BadRequestException('OWNER role is required');
    }
    return uniqueRoles;
  }

  private resolveSelectedBranchId(
    branches: { branch_id: string }[],
    branchId?: string,
  ): string {
    if (branchId) return branchId;
    if (branches.length === 1) return branches[0].branch_id;
    throw new BadRequestException('branch_id is required');
  }

  private getVerificationPurposeFilter(
    purpose: VerificationPurposeInput,
  ): VerificationPurposeFilter {
    if (purpose === 'LOGIN' || purpose === 'PHONE_LOGIN') {
      return { in: ['LOGIN', 'PHONE_LOGIN'] as VerificationPurpose[] };
    }
    return purpose as VerificationPurpose;
  }

  private async sendVerificationCode(input: {
    userId: string;
    target: string;
    channel: 'EMAIL' | 'PHONE';
    purpose: VerificationPurposeInput;
    isResend?: boolean;
  }) {
    await this.prismaService.db.verificationCode.updateMany({
      where: {
        user_id: input.userId,
        purpose: this.getVerificationPurposeFilter(input.purpose),
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
        is_resend: input.isResend ?? false,
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
    purpose: VerificationPurposeInput;
    code: string;
  }) {
    const record = await this.prismaService.db.verificationCode.findFirst({
      where: {
        user_id: input.userId,
        target: input.target,
        purpose: this.getVerificationPurposeFilter(input.purpose),
        consumed_at: null,
      },
      orderBy: { created_at: 'desc' },
    });
    if (!record) {
      throw new HttpException(
        {
          code: ERROR_CODES.INVALID_CODE,
          message: 'Verification code not found or already used',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (record.expires_at < new Date()) {
      throw new HttpException(
        {
          code: ERROR_CODES.CODE_EXPIRED,
          message: 'Verification code has expired',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (record.attempts >= record.max_attempts) {
      throw new HttpException(
        {
          code: ERROR_CODES.MAX_ATTEMPTS_EXCEEDED,
          message: 'Maximum verification attempts reached',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const matches = await bcrypt.compare(input.code, record.code_hash);
    if (!matches) {
      await this.prismaService.db.verificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new HttpException(
        {
          code: ERROR_CODES.INVALID_CODE,
          message: 'Incorrect verification code',
        },
        HttpStatus.BAD_REQUEST,
      );
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

  private tryDecodeAccessToken(authorization?: string): string | null {
    if (!authorization) return null;

    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (!match) return null;

    try {
      const payload = this.jwtService.verify<JwtAccessPayload>(match[1], {
        secret: this.authConfig.jwt.accessSecret,
      });
      return payload.type === 'access' ? payload.userId : null;
    } catch {
      return null;
    }
  }

  private resolveRegistrationStep(
    user: Pick<User, 'registration_status' | 'onboarding_completed'>,
  ): RegistrationStep {
    if (user.onboarding_completed) return 'DONE';
    if (user.registration_status === 'PENDING') return 'VERIFY_OTP';
    return 'COMPLETE_ONBOARDING';
  }

  private async issueTokenPair(
    user: Pick<User, 'id'>,
    profileId: string,
    accountId: string,
    activeBranchId?: string,
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
      ...(activeBranchId && { activeBranchId }),
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
    const token_hash = await bcrypt.hash(refresh_token, BCRYPT_ROUNDS);
    await this.prismaService.db.refreshToken.create({
      data: {
        jti,
        token_hash,
        user_id: user.id,
        profile_id: profileId,
        account_id: accountId,
        active_branch_id: activeBranchId ?? null,
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

  async getMe(userId: string, profileId: string) {
    const user = await this.prismaService.db.user.findFirst({
      where: { id: userId, is_deleted: false },
      include: {
        profiles: {
          where: { id: profileId, is_deleted: false },
          include: {
            account: true,
            roles: { include: { role: true } },
            branches: {
              where: { branch: { is_deleted: false } },
              include: { branch: true },
            },
          },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      phone: user.phone,
      is_active: user.is_active,
      verified_at: user.verified_at,
      created_at: user.created_at,
      profiles: user.profiles.map((profile) => ({
        staff_id: profile.id,
        job_title: profile.job_title,
        specialty: profile.specialty,
        is_clinical: profile.is_clinical,
        organization: {
          id: profile.account.id,
          name: profile.account.name,
          specialities: profile.account.specialities,
          status: profile.account.status,
        },
        roles: profile.roles.map((pr) => ({
          id: pr.role.id,
          name: pr.role.name,
        })),
        branches: profile.branches.map((pb) => ({
          id: pb.branch.id,
          address: pb.branch.address,
          city: pb.branch.city,
          governorate: pb.branch.governorate,
          country: pb.branch.country,
          is_main: pb.branch.is_main,
        })),
      })),
    };
  }

  private issuePasswordResetToken(
    userId: string,
    target: string,
    verified: boolean,
  ): ResetTokenResponseDto {
    const jti = randomUUID();
    const payload: PasswordResetTokenPayload = {
      userId,
      target,
      jti,
      type: 'password_reset',
      verified,
    };
    const expiresIn = this.parseDurationToSeconds(
      this.authConfig.jwt.registrationExpiration,
    );
    const reset_token = this.jwtService.sign(payload, {
      secret: this.authConfig.jwt.resetSecret,
      expiresIn,
    });
    return { reset_token, expires_in: expiresIn };
  }

  private decodePasswordResetToken(
    token: string,
    expectedVerified: boolean,
  ): { userId: string; target: string; jti: string } {
    let payload: PasswordResetTokenPayload;
    try {
      payload = this.jwtService.verify<PasswordResetTokenPayload>(token, {
        secret: this.authConfig.jwt.resetSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
    if (
      payload.type !== 'password_reset' ||
      payload.verified !== expectedVerified
    ) {
      throw new UnauthorizedException('Invalid reset token type or state');
    }
    return { userId: payload.userId, target: payload.target, jti: payload.jti };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<ResetTokenResponseDto> {
    const user = await this.prismaService.db.user.findFirst({
      where: {
        email: dto.email,
        is_deleted: false,
        is_active: true,
        verified_at: { not: null },
      },
    });

    if (!user?.email) {
      return { reset_token: '', expires_in: 0 };
    }

    await this.sendVerificationCode({
      userId: user.id,
      target: user.email,
      channel: 'EMAIL',
      purpose: 'PASSWORD_RESET',
    });

    return this.issuePasswordResetToken(user.id, user.email, false);
  }

  async resendPasswordResetCode(
    dto: ResendResetCodeDto,
  ): Promise<ResetTokenResponseDto> {
    const { userId, target } = this.decodePasswordResetToken(
      dto.reset_token,
      false,
    );

    const latestResend = await this.prismaService.db.verificationCode.findFirst(
      {
        where: { user_id: userId, purpose: 'PASSWORD_RESET', is_resend: true },
        orderBy: { created_at: 'desc' },
      },
    );
    if (
      latestResend &&
      latestResend.created_at.getTime() >
        Date.now() - SIGNUP_RESEND_COOLDOWN_SECONDS * 1000
    ) {
      throw new HttpException(
        'Please wait before requesting another code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const resendWindowStart = new Date(Date.now() - 60 * 60 * 1000);
    const recentResendCount =
      await this.prismaService.db.verificationCode.count({
        where: {
          user_id: userId,
          purpose: 'PASSWORD_RESET',
          is_resend: true,
          created_at: { gte: resendWindowStart },
        },
      });
    if (recentResendCount >= SIGNUP_RESEND_MAX_PER_HOUR) {
      throw new HttpException(
        'Too many resend requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.sendVerificationCode({
      userId,
      target,
      channel: 'EMAIL',
      purpose: 'PASSWORD_RESET',
      isResend: true,
    });

    return this.issuePasswordResetToken(userId, target, false);
  }

  async verifyResetCode(
    dto: VerifyResetCodeDto,
  ): Promise<ResetTokenResponseDto> {
    const { userId, target } = this.decodePasswordResetToken(
      dto.reset_token,
      false,
    );

    await this.consumeVerificationCode({
      userId,
      target,
      purpose: 'PASSWORD_RESET',
      code: dto.code,
    });

    return this.issuePasswordResetToken(userId, target, true);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const { userId } = this.decodePasswordResetToken(dto.reset_token, true);

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    await this.prismaService.db.$transaction([
      this.prismaService.db.user.update({
        where: { id: userId },
        data: { password_hashed: passwordHash },
      }),
      this.prismaService.db.refreshToken.updateMany({
        where: { user_id: userId, is_revoked: false },
        data: { is_revoked: true },
      }),
    ]);
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
