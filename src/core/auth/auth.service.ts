import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { AuthTokensDto } from './dto/auth-tokens.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RefreshDto } from './dto/refresh.dto.js';
import type { RegistrationStep } from './dto/registration-status-response.dto.js';
import type { ResendOtpDto } from './dto/resend-otp.dto.js';
import type { SignupCompleteDto } from './dto/signup-complete.dto.js';
import type { SignupStartDto } from './dto/signup-start.dto.js';
import type { SignupVerifyDto } from './dto/signup-verify.dto.js';
import type { SelectProfileDto } from './dto/select-profile.dto.js';
import type { JwtRefreshPayload } from './interfaces/jwt-payload.interface.js';
import type { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import type { VerifyResetCodeDto } from './dto/verify-reset-code.dto.js';
import type { ResetPasswordDto } from './dto/reset-password.dto.js';
import type { ResetTokenResponseDto } from './dto/reset-token-response.dto.js';
import type { ResendResetCodeDto } from './dto/resend-reset-code.dto.js';
import type { SwitchBranchDto } from './dto/switch-branch.dto.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { TokensService } from './services/tokens.service.js';
import { PasswordResetService } from './services/password-reset.service.js';
import { SignupService } from './services/signup.service.js';

export interface SelectableProfile {
  profile_id: string;
  organization_id: string;
  organization_name: string;
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
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly tokensService: TokensService,
    private readonly passwordResetService: PasswordResetService,
    private readonly signupService: SignupService,
  ) {}

  signupStart(dto: SignupStartDto) {
    return this.signupService.start(dto);
  }

  signupVerify(dto: SignupVerifyDto) {
    return this.signupService.verify(dto);
  }

  async signupComplete(
    dto: SignupCompleteDto,
  ): Promise<ProfileSelectionResponse> {
    const { userId } = await this.signupService.complete(dto);
    return this.buildProfileSelectionResponse(userId);
  }

  resendOtp(dto: ResendOtpDto) {
    return this.signupService.resendOtp(dto);
  }

  getRegistrationStatus(input: {
    email?: string;
    authorization?: string;
  }): Promise<{ step: RegistrationStep; email?: string }> {
    return this.signupService.getRegistrationStatus(input);
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
    const userId = this.tokensService.decodeSignupToken(
      dto.selection_token,
      'profile_selection',
    );
    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        id: dto.profile_id,
        user_id: userId,
        is_deleted: false,
        is_active: true,
        organization: { status: 'ACTIVE', is_deleted: false },
      },
      include: { user: true },
    });
    if (!profile) throw new ForbiddenException('Invalid profile selection');

    const effectiveBranchIds =
      await this.authorizationService.getEffectiveBranchIds(
        profile.id,
        profile.organization_id,
      );
    const branches = await this.prismaService.db.branch.findMany({
      where: {
        id: { in: effectiveBranchIds },
        organization_id: profile.organization_id,
        status: 'ACTIVE',
        is_deleted: false,
      },
      orderBy: { created_at: 'asc' },
    });

    const branchId = this.resolveSelectedBranchId(
      branches.map((b) => ({ branch_id: b.id })),
      dto.branch_id,
    );

    const selectedBranch = branches.find((b) => b.id === branchId);
    if (!selectedBranch) {
      throw new ForbiddenException('Invalid branch selection');
    }

    return this.tokensService.issueTokenPair({
      user: profile.user,
      profileId: profile.id,
      organizationId: profile.organization_id,
      activeBranchId: branchId,
    });
  }

  async refresh(dto: RefreshDto): Promise<AuthTokensDto> {
    const payload: JwtRefreshPayload = this.tokensService.decodeRefreshToken(
      dto.refresh_token,
    );

    const stored = await this.prismaService.db.refreshToken.findUnique({
      where: { jti: payload.jti },
      include: { user: true },
    });
    if (!stored || stored.is_revoked || stored.expires_at < new Date()) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }
    const matches = await bcrypt.compare(dto.refresh_token, stored.token_hash);
    if (!matches) throw new UnauthorizedException('Refresh token mismatch');
    if (!stored.profile_id || !stored.organization_id) {
      throw new UnauthorizedException('Refresh token has no profile context');
    }

    // Atomic rotation: revoke + new-row create run inside a single transaction
    // guarded by a count check on the prior jti. Two concurrent refreshes for
    // the same token cannot both succeed — only one updateMany returns count=1.
    return this.tokensService.issueTokenPair({
      user: stored.user,
      profileId: stored.profile_id,
      organizationId: stored.organization_id,
      activeBranchId: stored.active_branch_id ?? undefined,
      revokeJti: stored.jti,
    });
  }

  async logout(rawRefreshToken: string): Promise<void> {
    return this.tokensService.revokeRefreshToken(rawRefreshToken);
  }

  async switchBranch(
    user: AuthContext,
    dto: SwitchBranchDto,
  ): Promise<AuthTokensDto> {
    const canAccess = await this.authorizationService.canAccessBranch(
      user.profileId,
      user.organizationId,
      dto.branch_id,
    );
    if (!canAccess) throw new ForbiddenException('Branch access denied');

    return this.tokensService.issueTokenPair({
      user: { id: user.userId },
      profileId: user.profileId,
      organizationId: user.organizationId,
      activeBranchId: dto.branch_id,
    });
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
      selection_token: this.tokensService.issueSignupToken(
        userId,
        'profile_selection',
      ).signup_token,
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
        organization: { is_deleted: false, status: 'ACTIVE' },
      },
      include: {
        organization: true,
        roles: { include: { role: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    return Promise.all(
      profiles.map(async (profile) => {
        const branchIds = await this.authorizationService.getEffectiveBranchIds(
          profile.id,
          profile.organization_id,
        );
        const branches = await this.prismaService.db.branch.findMany({
          where: {
            id: { in: branchIds },
            organization_id: profile.organization_id,
            status: 'ACTIVE',
            is_deleted: false,
          },
          orderBy: { created_at: 'asc' },
        });
        return {
          profile_id: profile.id,
          organization_id: profile.organization.id,
          organization_name: profile.organization.name,
          roles: profile.roles.map((item) => item.role.code),
          branches: branches.map((b) => ({
            branch_id: b.id,
            name: b.name,
            is_main: b.is_main,
          })),
        };
      }),
    );
  }

  private resolveSelectedBranchId(
    branches: { branch_id: string }[],
    branchId?: string,
  ): string {
    if (branchId) return branchId;
    if (branches.length === 1) return branches[0].branch_id;
    throw new BadRequestException('branch_id is required');
  }

  async getMe(userId: string, profileId: string) {
    const user = await this.prismaService.db.user.findFirst({
      where: { id: userId, is_deleted: false },
      include: {
        profiles: {
          where: { id: profileId, is_deleted: false },
          include: {
            organization: {
              include: {
                specialty_links: { include: { specialty: true } },
              },
            },
            roles: { include: { role: true } },
            job_functions: { include: { job_function: true } },
            specialty_links: { include: { specialty: true } },
          },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    const profilesWithBranches = await Promise.all(
      user.profiles.map(async (profile) => {
        const branchIds = await this.authorizationService.getEffectiveBranchIds(
          profile.id,
          profile.organization_id,
        );
        const branches = await this.prismaService.db.branch.findMany({
          where: {
            id: { in: branchIds },
            organization_id: profile.organization_id,
            is_deleted: false,
          },
          orderBy: { created_at: 'asc' },
        });
        return { profile, branches };
      }),
    );

    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      phone_number: user.phone_number,
      is_active: user.is_active,
      verified_at: user.verified_at,
      created_at: user.created_at,
      profiles: profilesWithBranches.map(({ profile, branches }) => ({
        staff_id: profile.id,
        executive_title: profile.executive_title,
        engagement_type: profile.engagement_type,
        organization: {
          id: profile.organization.id,
          name: profile.organization.name,
          specialties: profile.organization.specialty_links.map((l) => ({
            id: l.specialty.id,
            code: l.specialty.code,
            name: l.specialty.name,
          })),
          status: profile.organization.status,
        },
        roles: profile.roles.map((pr) => ({
          id: pr.role.id,
          name: pr.role.name,
        })),
        branches: branches.map((b) => ({
          id: b.id,
          address: b.address,
          city: b.city,
          governorate: b.governorate,
          country: b.country,
          is_main: b.is_main,
        })),
        job_functions: profile.job_functions.map((jf) => ({
          id: jf.job_function.id,
          code: jf.job_function.code,
          name: jf.job_function.name,
          is_clinical: jf.job_function.is_clinical,
        })),
        specialties: profile.specialty_links.map((sl) => ({
          id: sl.specialty.id,
          code: sl.specialty.code,
          name: sl.specialty.name,
        })),
      })),
    };
  }

  forgotPassword(dto: ForgotPasswordDto): Promise<ResetTokenResponseDto> {
    return this.passwordResetService.start(dto);
  }

  resendPasswordResetCode(
    dto: ResendResetCodeDto,
  ): Promise<ResetTokenResponseDto> {
    return this.passwordResetService.resend(dto);
  }

  verifyResetCode(dto: VerifyResetCodeDto): Promise<ResetTokenResponseDto> {
    return this.passwordResetService.verify(dto);
  }

  resetPassword(dto: ResetPasswordDto): Promise<void> {
    return this.passwordResetService.reset(dto);
  }
}
