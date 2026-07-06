import { Module } from '@nestjs/common';
import { RetentionSweepService } from './retention-sweep.service.js';

/**
 * Nightly audit-log retention sweep. `ScheduleModule.forRoot()` (registered in
 * AppModule) drives the `@Cron`. Inert unless `RETENTION_SWEEP_ENABLED=true`.
 */
@Module({
  providers: [RetentionSweepService],
})
export class RetentionModule {}
