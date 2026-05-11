import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../common/authorization/authorization.module';
import { LabTestsModule } from '../lab-tests/lab-tests.module';
import { MedicationsModule } from '../medications/medications.module';
import { FormTemplatesModule } from '../form-templates/form-templates.module';
import { VisitAccessService } from './visit-access.service';
import { VitalsController } from './vitals.controller';
import { VitalsService } from './vitals.service';
import { EncounterController } from './encounter.controller';
import { EncounterService } from './encounter.service';
import { InvestigationsController } from './investigations.controller';
import { InvestigationsService } from './investigations.service';
import { PrescriptionsController } from './prescriptions.controller';
import { PrescriptionsService } from './prescriptions.service';

@Module({
  imports: [
    AuthorizationModule,
    LabTestsModule,
    MedicationsModule,
    FormTemplatesModule,
  ],
  controllers: [
    VitalsController,
    EncounterController,
    InvestigationsController,
    PrescriptionsController,
  ],
  providers: [
    VisitAccessService,
    VitalsService,
    EncounterService,
    InvestigationsService,
    PrescriptionsService,
  ],
  exports: [VisitAccessService],
})
export class ClinicalModule {}
