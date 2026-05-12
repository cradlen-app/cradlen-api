import { Module } from '@nestjs/common';
import { ObgynPatientAccessService } from './patient-access.service';
import { ObgynHistoryController } from './patient-history/obgyn-history.controller';
import { ObgynHistoryService } from './patient-history/obgyn-history.service';
import { ObgynEncounterController } from './visit-encounter/obgyn-encounter.controller';
import { ObgynEncounterService } from './visit-encounter/obgyn-encounter.service';
import { PregnancyController } from './pregnancy/pregnancy.controller';
import { PregnancyService } from './pregnancy/pregnancy.service';

@Module({
  controllers: [
    ObgynHistoryController,
    ObgynEncounterController,
    PregnancyController,
  ],
  providers: [
    ObgynPatientAccessService,
    ObgynHistoryService,
    ObgynEncounterService,
    PregnancyService,
  ],
})
export class ObgynModule {}
