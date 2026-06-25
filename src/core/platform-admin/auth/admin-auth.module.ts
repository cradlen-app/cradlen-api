import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '@core/auth/auth.module.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminVerificationService } from './admin-verification.service.js';
import { AdminJwtStrategy } from './strategies/admin-jwt.strategy.js';

/**
 * Platform-admin identity layer. Reuses AuthModule's TokensService for token
 * issuance and registers a dedicated `admin-jwt` strategy so admin tokens never
 * validate against the staff guard (and vice versa). Mirrors PatientAuthModule.
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    AuthModule,
  ],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminVerificationService, AdminJwtStrategy],
})
export class AdminAuthModule {}
