import { Module } from '@nestjs/common';
import { VisitsModule } from '@core/clinical/visits/visits.public';
import { ObgynPatientAccessService } from './patient-access.service';
import { ObgynHistoryController } from './patient-history/obgyn-history.controller';
import { ObgynHistoryService } from './patient-history/obgyn-history.service';
import { ObgynEncounterController } from './visit-encounter/obgyn-encounter.controller';
import { ObgynEncounterService } from './visit-encounter/obgyn-encounter.service';
import { ObgynExaminationController } from './visit-examination/obgyn-examination.controller';
import { ObgynExaminationService } from './visit-examination/obgyn-examination.service';
import { PregnancyController } from './pregnancy/pregnancy.controller';
import { PregnancyService } from './pregnancy/pregnancy.service';
import { AmendmentsController } from './amendments/amendments.controller';
import { AmendmentsService } from './amendments/amendments.service';
import { HistorySummaryController } from './history-summary/history-summary.controller';
import { HistorySummaryService } from './history-summary/history-summary.service';

@Module({
  imports: [VisitsModule],
  controllers: [
    ObgynHistoryController,
    ObgynEncounterController,
    ObgynExaminationController,
    PregnancyController,
    AmendmentsController,
    HistorySummaryController,
  ],
  providers: [
    ObgynPatientAccessService,
    ObgynHistoryService,
    ObgynEncounterService,
    ObgynExaminationService,
    PregnancyService,
    AmendmentsService,
    HistorySummaryService,
  ],
})
export class ObgynModule {}
