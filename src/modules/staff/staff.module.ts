import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
