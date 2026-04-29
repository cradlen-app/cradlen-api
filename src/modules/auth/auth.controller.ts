import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  ApiStandardResponse,
  ApiVoidResponse,
} from '../../common/swagger/index.js';
import { AuthService } from './auth.service.js';
import { AuthTokensDto } from './dto/auth-tokens.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RequestPhoneOtpDto, VerifyPhoneOtpDto } from './dto/phone-otp.dto.js';
import { SelectProfileDto } from './dto/select-profile.dto.js';
import { SignupCompleteDto } from './dto/signup-complete.dto.js';
import { SignupStartDto } from './dto/signup-start.dto.js';
import { SignupVerifyDto } from './dto/signup-verify.dto.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup/start')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start owner signup and send verification code' })
  signupStart(@Body() dto: SignupStartDto) {
    return this.authService.signupStart(dto);
  }

  @Post('signup/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify signup code and activate identity' })
  signupVerify(@Body() dto: SignupVerifyDto) {
    return this.authService.signupVerify(dto);
  }

  @Post('signup/complete')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create account, branch, profile, roles, and subscription',
  })
  @ApiStandardResponse(AuthTokensDto)
  signupComplete(@Body() dto: SignupCompleteDto) {
    return this.authService.signupComplete(dto);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate email/password and return selectable profiles',
  })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('phone/request-otp')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request phone OTP login code' })
  requestPhoneOtp(@Body() dto: RequestPhoneOtpDto) {
    return this.authService.requestPhoneOtp(dto);
  }

  @Post('phone/verify-otp')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify phone OTP and return selectable profiles' })
  verifyPhoneOtp(@Body() dto: VerifyPhoneOtpDto) {
    return this.authService.verifyPhoneOtp(dto);
  }

  @Post('profiles/select')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue tenant-scoped tokens for selected profile' })
  @ApiStandardResponse(AuthTokensDto)
  selectProfile(@Body() dto: SelectProfileDto) {
    return this.authService.selectProfile(dto);
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
}
