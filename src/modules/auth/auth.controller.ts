import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import {
  ApiStandardResponse,
  ApiVoidResponse,
} from '../../common/swagger/index.js';
import type { AuthContext } from '../../common/interfaces/auth-context.interface.js';
import { AuthService } from './auth.service.js';
import { MeResponseDto } from './dto/me-response.dto.js';
import { AuthTokensDto } from './dto/auth-tokens.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegistrationStatusQueryDto } from './dto/registration-status-query.dto.js';
import { RegistrationStatusResponseDto } from './dto/registration-status-response.dto.js';
import { ResendOtpDto } from './dto/resend-otp.dto.js';
import { ResendOtpResponseDto } from './dto/resend-otp-response.dto.js';
import { SelectProfileDto } from './dto/select-profile.dto.js';
import { SignupCompleteDto } from './dto/signup-complete.dto.js';
import { SignupStartDto } from './dto/signup-start.dto.js';
import { SignupTokenResponseDto } from './dto/signup-token-response.dto.js';
import { SignupVerifyDto } from './dto/signup-verify.dto.js';
import { ProfileSelectionResponseDto } from './dto/profile-selection-response.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResendResetCodeDto } from './dto/resend-reset-code.dto.js';
import { VerifyResetCodeDto } from './dto/verify-reset-code.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { ResetTokenResponseDto } from './dto/reset-token-response.dto.js';
import { SwitchBranchDto } from './dto/switch-branch.dto.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current authenticated user and active profile',
  })
  @ApiStandardResponse(MeResponseDto)
  getMe(@CurrentUser() user: AuthContext) {
    return this.authService.getMe(user.userId, user.profileId);
  }

  @Post('signup/start')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start owner signup and send verification code' })
  @ApiStandardResponse(SignupTokenResponseDto)
  signupStart(@Body() dto: SignupStartDto) {
    return this.authService.signupStart(dto);
  }

  @Post('signup/verify')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify signup code and activate identity' })
  @ApiStandardResponse(SignupTokenResponseDto)
  signupVerify(@Body() dto: SignupVerifyDto) {
    return this.authService.signupVerify(dto);
  }

  @Post('signup/complete')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create account, branch, profile, roles, subscription, and return selectable profiles',
  })
  @ApiStandardResponse(ProfileSelectionResponseDto)
  signupComplete(@Body() dto: SignupCompleteDto) {
    return this.authService.signupComplete(dto);
  }

  @Post('signup/resend')
  @Public()
  @Throttle({ default: { limit: 3, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend signup verification code' })
  @ApiStandardResponse(ResendOtpResponseDto)
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  @Get('registration/status')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get registration onboarding status' })
  @ApiStandardResponse(RegistrationStatusResponseDto)
  getRegistrationStatus(
    @Query() query: RegistrationStatusQueryDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.authService.getRegistrationStatus({
      email: query.email,
      authorization,
    });
  }

  @Post('login')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate email/password and return selectable profiles',
  })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('profiles/select')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue tenant-scoped tokens for selected profile' })
  @ApiStandardResponse(AuthTokensDto)
  selectProfile(@Body() dto: SelectProfileDto) {
    return this.authService.selectProfile(dto);
  }

  @Post('branches/switch')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Switch active branch and rotate token pair' })
  @ApiStandardResponse(AuthTokensDto)
  switchBranch(
    @CurrentUser() user: AuthContext,
    @Body() dto: SwitchBranchDto,
  ): Promise<AuthTokensDto> {
    return this.authService.switchBranch(user, dto);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate contextual token pair' })
  @ApiStandardResponse(AuthTokensDto)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke refresh token' })
  @ApiVoidResponse()
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.authService.logout(dto.refresh_token);
  }

  @Post('forgot-password')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send password reset code to email' })
  @ApiStandardResponse(ResetTokenResponseDto)
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<ResetTokenResponseDto> {
    return this.authService.forgotPassword(dto);
  }

  @Post('forgot-password/resend')
  @Public()
  @Throttle({ default: { limit: 3, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Resend password reset code (rate limited: 60s cooldown, max 5/hr)',
  })
  @ApiStandardResponse(ResetTokenResponseDto)
  resendPasswordResetCode(
    @Body() dto: ResendResetCodeDto,
  ): Promise<ResetTokenResponseDto> {
    return this.authService.resendPasswordResetCode(dto);
  }

  @Post('verify-reset-code')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify password reset code and get verified reset token',
  })
  @ApiStandardResponse(ResetTokenResponseDto)
  verifyResetCode(
    @Body() dto: VerifyResetCodeDto,
  ): Promise<ResetTokenResponseDto> {
    return this.authService.verifyResetCode(dto);
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set new password using verified reset token' })
  @ApiVoidResponse()
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.authService.resetPassword(dto);
  }
}
