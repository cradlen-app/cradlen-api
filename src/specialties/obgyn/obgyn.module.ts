import { Module } from '@nestjs/common';
import { VisitsModule } from '@core/clinical/visits/visits.public';
import { PatientAccessModule } from '@core/patient/patient-access/patient-access.public';
import { ObgynHistoryController } from './patient-history/obgyn-history.controller';
import { ObgynHistoryService } from './patient-history/obgyn-history.service';
import { ObgynExaminationController } from './visit-examination/obgyn-examination.controller';
import { ObgynExaminationService } from './visit-examination/obgyn-examination.service';
import { AmendmentsController } from './amendments/amendments.controller';
import { AmendmentsService } from './amendments/amendments.service';
import { HistorySummaryController } from './history-summary/history-summary.controller';
import { HistorySummaryService } from './history-summary/history-summary.service';
import { JourneySummaryController } from './journey-summary/journey-summary.controller';
import { JourneySummaryService } from './journey-summary/journey-summary.service';
import { ObgynPortalHistoryController } from './patient-portal/obgyn-portal-history.controller';
import { ObgynPortalHistoryService } from './patient-portal/obgyn-portal-history.service';

@Module({
  imports: [VisitsModule, PatientAccessModule],
  controllers: [
    ObgynHistoryController,
    ObgynExaminationController,
    AmendmentsController,
    HistorySummaryController,
    JourneySummaryController,
    ObgynPortalHistoryController,
  ],
  providers: [
    ObgynHistoryService,
    ObgynExaminationService,
    AmendmentsService,
    HistorySummaryService,
    JourneySummaryService,
    ObgynPortalHistoryService,
  ],
  // Exported so the pregnancy clinical surface can fold the patient's history
  // blood group into its read-only summary (single source of truth).
  exports: [ObgynHistoryService],
})
export class ObgynModule {}
