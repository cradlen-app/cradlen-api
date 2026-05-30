import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller.js';
import { PatientsService } from './patients.service.js';
import { OverdueVisitSweepService } from './overdue-visit-sweep.service.js';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { VisitsModule } from '@core/clinical/visits/visits.module.js';
import { PatientAccessModule } from '@core/patient/patient-access/patient-access.public.js';

@Module({
  imports: [AuthorizationModule, VisitsModule, PatientAccessModule],
  controllers: [PatientsController],
  providers: [PatientsService, OverdueVisitSweepService],
})
export class PatientsModule {}
