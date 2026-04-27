import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';
import { MailModule } from '../mail/mail.module.js';

@Module({
  imports: [MailModule, JwtModule.register({})],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
