import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth.module.js';
import { PatientAuthController } from './patient-auth.controller.js';
import { PatientSignupService } from './patient-signup.service.js';
import { PatientJwtStrategy } from './strategies/patient-jwt.strategy.js';

/**
 * Patient-facing identity layer. Reuses AuthModule's TokensService for token
 * issuance and registers a dedicated `patient-jwt` strategy so patient tokens
 * never validate against the staff guard (and vice versa).
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    AuthModule,
  ],
  controllers: [PatientAuthController],
  providers: [PatientSignupService, PatientJwtStrategy],
})
export class PatientAuthModule {}
