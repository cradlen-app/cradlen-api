import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthController } from './auth.controller.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { EmailModule } from '@infrastructure/email/email.module.js';
import { RegistrationCleanupService } from './registration-cleanup.service.js';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { SpecialtyCatalogModule } from '@core/org/specialty-catalog/specialty-catalog.public.js';
import { TokensService } from './services/tokens.service.js';
import { VerificationCodesService } from './services/verification-codes.service.js';
import { PasswordResetService } from './services/password-reset.service.js';
import { SignupService } from './services/signup.service.js';
import { SessionsService } from './services/sessions.service.js';
import { AuthAuditListener } from './events/auth-audit.listener.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    EmailModule,
    AuthorizationModule,
    SpecialtyCatalogModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AuthController],
  providers: [
    TokensService,
    VerificationCodesService,
    PasswordResetService,
    SignupService,
    SessionsService,
    JwtStrategy,
    RegistrationCleanupService,
    AuthAuditListener,
  ],
})
export class AuthModule {}
