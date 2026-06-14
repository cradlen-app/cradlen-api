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
import { CurrentPatient } from '@common/decorators/current-patient.decorator.js';
import { IdentifierThrottlerGuard } from '@common/guards/identifier-throttler.guard.js';
import { PatientJwtAuthGuard } from '@common/guards/patient-jwt-auth.guard.js';
import { ApiStandardResponse, ApiVoidResponse } from '@common/swagger/index.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { AuthTokensDto } from '@core/auth/dto/auth-tokens.dto.js';
import { RefreshDto } from '@core/auth/dto/refresh.dto.js';
import { LogoutDto } from '@core/auth/dto/logout.dto.js';
import { PatientSignupService } from './patient-signup.service.js';
import { PatientSignupStartDto } from './dto/patient-signup-start.dto.js';
import { PatientSignupStartResponseDto } from './dto/patient-signup-start-response.dto.js';
import { PatientSignupCompleteDto } from './dto/patient-signup-complete.dto.js';
import { PatientLoginDto } from './dto/patient-login.dto.js';
import { PatientMeResponseDto } from './dto/patient-me-response.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { SetSecurityQuestionDto } from './dto/set-security-question.dto.js';
import { PatientForgotPasswordStartDto } from './dto/patient-forgot-password-start.dto.js';
import { PatientForgotPasswordStartResponseDto } from './dto/patient-forgot-password-start-response.dto.js';
import { PatientForgotPasswordCompleteDto } from './dto/patient-forgot-password-complete.dto.js';

@ApiTags('Patient Auth')
@Controller({ path: 'patient-auth', version: '1' })
export class PatientAuthController {
  constructor(private readonly patientSignupService: PatientSignupService) {}

  @Post('signup/start')
  @Public()
  @UseGuards(IdentifierThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Match an existing patient/guardian and start self-signup',
  })
  @ApiStandardResponse(PatientSignupStartResponseDto)
  signupStart(@Body() dto: PatientSignupStartDto) {
    return this.patientSignupService.start(dto);
  }

  @Post('signup/complete')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Set password, create the account, and log in' })
  @ApiStandardResponse(AuthTokensDto)
  signupComplete(@Body() dto: PatientSignupCompleteDto) {
    return this.patientSignupService.complete(dto);
  }

  @Post('login')
  @Public()
  @UseGuards(IdentifierThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Patient/guardian login by national ID + password' })
  @ApiStandardResponse(AuthTokensDto)
  login(@Body() dto: PatientLoginDto) {
    return this.patientSignupService.login(dto);
  }

  @Post('forgot-password/start')
  @Public()
  @UseGuards(IdentifierThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify identity and return the account security question',
  })
  @ApiStandardResponse(PatientForgotPasswordStartResponseDto)
  forgotPasswordStart(@Body() dto: PatientForgotPasswordStartDto) {
    return this.patientSignupService.forgotPasswordStart(dto);
  }

  @Post('forgot-password/complete')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Verify the security answer and set a new password',
  })
  @ApiVoidResponse()
  async forgotPasswordComplete(
    @Body() dto: PatientForgotPasswordCompleteDto,
  ): Promise<void> {
    await this.patientSignupService.forgotPasswordComplete(dto);
  }

  @Post('refresh')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 600000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a patient refresh token for a fresh pair' })
  @ApiStandardResponse(AuthTokensDto)
  refresh(@Body() dto: RefreshDto) {
    return this.patientSignupService.refresh(dto);
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a patient refresh token' })
  @ApiVoidResponse()
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.patientSignupService.logout(dto.refresh_token);
  }

  @Get('me')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current patient/guardian identity' })
  @ApiStandardResponse(PatientMeResponseDto)
  me(
    @CurrentPatient() patient: PatientAuthContext,
  ): Promise<PatientMeResponseDto> {
    return this.patientSignupService.me(patient);
  }

  @Post('change-password')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Change the current account's password" })
  @ApiVoidResponse()
  async changePassword(
    @CurrentPatient() patient: PatientAuthContext,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.patientSignupService.changePassword(patient, dto);
  }

  @Post('security-question')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Set or update the current account's security question",
  })
  @ApiVoidResponse()
  async setSecurityQuestion(
    @CurrentPatient() patient: PatientAuthContext,
    @Body() dto: SetSecurityQuestionDto,
  ): Promise<void> {
    await this.patientSignupService.setSecurityQuestion(patient, dto);
  }
}
