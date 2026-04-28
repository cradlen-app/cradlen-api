import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { StaffModule } from '../staff/staff.module.js';

@Module({
  imports: [StaffModule],
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}
