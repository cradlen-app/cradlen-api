import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { MailModule } from '../mail/mail.module.js';
import { RegistrationCleanupService } from './registration-cleanup.service.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    MailModule,
    AuthorizationModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RegistrationCleanupService],
})
export class AuthModule {}
