import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule],
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}
