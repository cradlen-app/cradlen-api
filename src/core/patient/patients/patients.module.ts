import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller.js';
import { PatientsService } from './patients.service.js';
import { OverdueVisitSweepService } from './overdue-visit-sweep.service.js';
import { AuthorizationModule } from '@core/auth/authorization/authorization.module.js';
import { VisitsModule } from '@core/clinical/visits/visits.module.js';
import { PatientHistoryModule } from '@core/clinical/patient-history/patient-history.module.js';

@Module({
  imports: [AuthorizationModule, VisitsModule, PatientHistoryModule],
  controllers: [PatientsController],
  providers: [PatientsService, OverdueVisitSweepService],
})
export class PatientsModule {}
