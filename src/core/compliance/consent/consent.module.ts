import { Module } from '@nestjs/common';
import { PatientAccessModule } from '@core/patient/patient-access/patient-access.public.js';
import { ConsentService } from './consent.service.js';
import { ConsentController } from './consent.controller.js';

/**
 * Patient consent capture (controller tooling). `EventBus` and `PrismaService`
 * come from their global modules; `PatientAccessModule` supplies the
 * `assertPatientInOrg` org-scope gate.
 */
@Module({
  imports: [PatientAccessModule],
  controllers: [ConsentController],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
