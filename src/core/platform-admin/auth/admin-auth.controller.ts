import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator.js';
import { AdminJwtAuthGuard } from '@common/guards/admin-jwt-auth.guard.js';
import { IdentifierThrottlerGuard } from '@common/guards/identifier-throttler.guard.js';
import { ApiStandardResponse, ApiVoidResponse } from '@common/swagger/index.js';
import type { AdminAuthContext } from '@common/interfaces/admin-auth-context.interface.js';
import { AuthTokensDto } from '@core/auth/dto/auth-tokens.dto.js';
import { RefreshDto } from '@core/auth/dto/refresh.dto.js';
import { LogoutDto } from '@core/auth/dto/logout.dto.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminLoginDto } from './dto/admin-login.dto.js';
import { AdminLoginResponseDto } from './dto/admin-login-response.dto.js';
import { AdminVerifyOtpDto } from './dto/admin-verify-otp.dto.js';
import { AdminResendOtpDto } from './dto/admin-resend-otp.dto.js';
import { AdminMeResponseDto } from './dto/admin-me-response.dto.js';
import { AdminSetPasswordDto } from './dto/admin-set-password.dto.js';

@ApiTags('Platform Admin Auth')
@Controller({ path: 'admin/auth', version: '1' })
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  @Public()
  @UseGuards(IdentifierThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin login step 1: verify password, email a code',
  })
  @ApiStandardResponse(AdminLoginResponseDto)
  login(@Body() dto: AdminLoginDto): Promise<AdminLoginResponseDto> {
    return this.adminAuthService.login(dto);
  }

  @Post('verify-otp')
  @Public()
  @UseGuards(IdentifierThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin login step 2: verify the code, issue tokens',
  })
  @ApiStandardResponse(AuthTokensDto)
  verifyOtp(@Body() dto: AdminVerifyOtpDto): Promise<AuthTokensDto> {
    return this.adminAuthService.verifyOtp(dto);
  }

  @Post('resend-otp')
  @Public()
  @UseGuards(IdentifierThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Re-send the admin login code' })
  @ApiVoidResponse()
  async resendOtp(@Body() dto: AdminResendOtpDto): Promise<void> {
    await this.adminAuthService.resendOtp(dto);
  }

  @Post('set-password')
  @Public()
  @UseGuards(IdentifierThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set an invited admin password from the email token (and log in)',
  })
  @ApiStandardResponse(AuthTokensDto)
  setPassword(@Body() dto: AdminSetPasswordDto): Promise<AuthTokensDto> {
    return this.adminAuthService.setPassword(dto);
  }

  @Post('refresh')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate an admin refresh token for a fresh pair' })
  @ApiStandardResponse(AuthTokensDto)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokensDto> {
    return this.adminAuthService.refresh(dto.refresh_token);
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an admin refresh token' })
  @ApiVoidResponse()
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.adminAuthService.logout(dto.refresh_token);
  }

  @Get('me')
  @Public()
  @UseGuards(AdminJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current platform-admin identity' })
  @ApiStandardResponse(AdminMeResponseDto)
  me(@CurrentAdmin() admin: AdminAuthContext): Promise<AdminMeResponseDto> {
    return this.adminAuthService.me(admin);
  }
}
