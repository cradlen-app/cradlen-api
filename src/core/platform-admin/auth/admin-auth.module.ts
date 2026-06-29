import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '@core/auth/auth.module.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminVerificationService } from './admin-verification.service.js';
import { AdminJwtStrategy } from './strategies/admin-jwt.strategy.js';
import { AdminAuditModule } from '../audit/admin-audit.module.js';

/**
 * Platform-admin identity layer. Reuses AuthModule's TokensService for token
 * issuance and registers a dedicated `admin-jwt` strategy so admin tokens never
 * validate against the staff guard (and vice versa). Mirrors PatientAuthModule.
 * Exports AdminVerificationService so the Admins surface can send set-password
 * invites through the same machinery.
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    AuthModule,
    AdminAuditModule,
  ],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminVerificationService, AdminJwtStrategy],
  exports: [AdminVerificationService],
})
export class AdminAuthModule {}
