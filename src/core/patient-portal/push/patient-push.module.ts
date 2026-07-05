import { Global, Module } from '@nestjs/common';
import { PatientPushController } from './patient-push.controller.js';
import { PatientPushService } from './patient-push.service.js';

/**
 * Patient Web Push: subscription endpoints + the fan-out service. Global so the
 * patient notifications listener can inject PatientPushService to push on every
 * new notification, mirroring AdminPushModule. PrismaService is global.
 */
@Global()
@Module({
  controllers: [PatientPushController],
  providers: [PatientPushService],
  exports: [PatientPushService],
})
export class PatientPushModule {}
