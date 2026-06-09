import { Module } from '@nestjs/common';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { ReportingController } from './reporting.controller.js';
import { ReportingService } from './reporting.service.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [ReportingController],
  providers: [ReportingService],
})
export class ReportingModule {}
