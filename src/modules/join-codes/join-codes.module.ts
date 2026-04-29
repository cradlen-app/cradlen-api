import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { JoinCodesController } from './join-codes.controller.js';
import { JoinCodesService } from './join-codes.service.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule],
  controllers: [JoinCodesController],
  providers: [JoinCodesService],
})
export class JoinCodesModule {}
