import { Injectable } from '@nestjs/common';
import type { AuthTokensDto } from './dto/auth-tokens.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RefreshDto } from './dto/refresh.dto.js';
import type { RegistrationStep } from './dto/registration-status-response.dto.js';
import type { ResendOtpDto } from './dto/resend-otp.dto.js';
import type { SignupCompleteDto } from './dto/signup-complete.dto.js';
import type { SignupStartDto } from './dto/signup-start.dto.js';
import type { SignupVerifyDto } from './dto/signup-verify.dto.js';
import type { SelectProfileDto } from './dto/select-profile.dto.js';
import type { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import type { VerifyResetCodeDto } from './dto/verify-reset-code.dto.js';
import type { ResetPasswordDto } from './dto/reset-password.dto.js';
import type { ResetTokenResponseDto } from './dto/reset-token-response.dto.js';
import type { ResendResetCodeDto } from './dto/resend-reset-code.dto.js';
import type { SwitchBranchDto } from './dto/switch-branch.dto.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { PasswordResetService } from './services/password-reset.service.js';
import { SignupService } from './services/signup.service.js';
import {
  SessionsService,
  type ProfileSelectionResponse,
} from './services/sessions.service.js';

export type {
  SelectableProfile,
  ProfileSelectionResponse,
  OnboardingRequiredResponse,
} from './services/sessions.service.js';

/**
 * Thin orchestrator that the controller still talks to. Concrete behavior
 * lives in the per-feature services; this class only routes calls and
 * stitches together the two-step signupComplete flow. The controller will
 * be repointed at the per-feature services in the final cleanup step.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly signupService: SignupService,
    private readonly sessionsService: SessionsService,
    private readonly passwordResetService: PasswordResetService,
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
    return this.sessionsService.buildProfileSelectionResponse(userId);
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

  login(dto: LoginDto) {
    return this.sessionsService.login(dto);
  }

  selectProfile(dto: SelectProfileDto): Promise<AuthTokensDto> {
    return this.sessionsService.selectProfile(dto);
  }

  refresh(dto: RefreshDto): Promise<AuthTokensDto> {
    return this.sessionsService.refresh(dto);
  }

  logout(rawRefreshToken: string): Promise<void> {
    return this.sessionsService.logout(rawRefreshToken);
  }

  switchBranch(
    user: AuthContext,
    dto: SwitchBranchDto,
  ): Promise<AuthTokensDto> {
    return this.sessionsService.switchBranch(user, dto);
  }

  getMe(userId: string, profileId: string) {
    return this.sessionsService.getMe(userId, profileId);
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
