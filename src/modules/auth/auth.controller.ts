import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  ApiStandardResponse,
  ApiVoidResponse,
} from '../../common/swagger/index.js';
import { AuthService } from './auth.service.js';
import { RegisterPersonalDto } from './dto/register-personal.dto.js';
import { RegistrationTokenResponseDto } from './dto/registration-token-response.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { ResendOtpDto } from './dto/resend-otp.dto.js';
import { RegisterOrganizationDto } from './dto/register-organization.dto.js';
import { AuthTokensDto } from './dto/auth-tokens.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
import { MeResponseDto } from './dto/me-response.dto.js';

@ApiTags('Auth')
@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register/personal')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Step 1 — submit personal info, receive registration token + OTP email',
  })
  @ApiStandardResponse(RegistrationTokenResponseDto)
  registerPersonal(
    @Body() dto: RegisterPersonalDto,
  ): Promise<RegistrationTokenResponseDto> {
    return this.authService.registerPersonal(dto);
  }

  @Post('register/verify-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Step 2 — submit 6-digit OTP, receive fresh registration token',
  })
  @ApiStandardResponse(RegistrationTokenResponseDto)
  verifyEmail(
    @Body() dto: VerifyEmailDto,
  ): Promise<RegistrationTokenResponseDto> {
    return this.authService.verifyEmail(dto.registration_token, dto.code);
  }

  @Post('register/resend-otp')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Resend OTP — 60s cooldown, max 5 attempts per registration window',
  })
  @ApiStandardResponse(RegistrationTokenResponseDto)
  resendOtp(@Body() dto: ResendOtpDto): Promise<RegistrationTokenResponseDto> {
    return this.authService.resendOtp(dto.registration_token);
  }

  @Post('register/organization')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Step 3 — Start Free Trial: create org, branch, staff, subscription → auth tokens',
  })
  @ApiStandardResponse(AuthTokensDto)
  registerOrganization(
    @Body() dto: RegisterOrganizationDto,
  ): Promise<AuthTokensDto> {
    return this.authService.registerOrganization(dto);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiStandardResponse(AuthTokensDto)
  login(@Body() dto: LoginDto): Promise<AuthTokensDto> {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate access + refresh token pair' })
  @ApiStandardResponse(AuthTokensDto)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokensDto> {
    return this.authService.refresh(dto.refresh_token);
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke refresh token' })
  @ApiVoidResponse()
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.authService.logout(dto.refresh_token);
  }

  @Get('me')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current authenticated user' })
  @ApiStandardResponse(MeResponseDto)
  me(@CurrentUser() user: User): MeResponseDto {
    return this.authService.getMe(user);
  }
}
