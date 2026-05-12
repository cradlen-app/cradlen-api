import { Module } from '@nestjs/common';
import { VisitsModule } from '@core/clinical/visits/visits.public';
import { ObgynPatientAccessService } from './patient-access.service';
import { ObgynHistoryController } from './patient-history/obgyn-history.controller';
import { ObgynHistoryService } from './patient-history/obgyn-history.service';
import { ObgynEncounterController } from './visit-encounter/obgyn-encounter.controller';
import { ObgynEncounterService } from './visit-encounter/obgyn-encounter.service';
import { PregnancyController } from './pregnancy/pregnancy.controller';
import { PregnancyService } from './pregnancy/pregnancy.service';
import { AmendmentsController } from './amendments/amendments.controller';
import { AmendmentsService } from './amendments/amendments.service';

@Module({
  imports: [VisitsModule],
  controllers: [
    ObgynHistoryController,
    ObgynEncounterController,
    PregnancyController,
    AmendmentsController,
  ],
  providers: [
    ObgynPatientAccessService,
    ObgynHistoryService,
    ObgynEncounterService,
    PregnancyService,
    AmendmentsService,
  ],
})
export class ObgynModule {}
