import { Module } from '@nestjs/common';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { OwnerModule } from '../owner/owner.module.js';

@Module({
  imports: [OwnerModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
