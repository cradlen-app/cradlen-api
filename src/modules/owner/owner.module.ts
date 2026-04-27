import { Module } from '@nestjs/common';
import { OwnerController } from './owner.controller.js';
import { OwnerService } from './owner.service.js';
import { StaffModule } from '../staff/staff.module.js';

@Module({
  imports: [StaffModule],
  controllers: [OwnerController],
  providers: [OwnerService],
})
export class OwnerModule {}
