import { Module } from '@nestjs/common';
import { MedicationsModule } from '../medications/medications.module';
import { PatientAccessService } from './patient-access.service';
import { SnapshotController } from './snapshot.controller';
import { SnapshotService } from './snapshot.service';
import { AllergiesController } from './allergies.controller';
import { AllergiesService } from './allergies.service';
import { PregnanciesController } from './pregnancies.controller';
import { PregnanciesService } from './pregnancies.service';
import { ContraceptivesController } from './contraceptives.controller';
import { ContraceptivesService } from './contraceptives.service';
import { NonGynSurgeriesController } from './non-gyn-surgeries.controller';
import { NonGynSurgeriesService } from './non-gyn-surgeries.service';
import { PatientMedicationsController } from './patient-medications.controller';
import { PatientMedicationsService } from './patient-medications.service';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';

@Module({
  imports: [MedicationsModule],
  controllers: [
    SnapshotController,
    AllergiesController,
    PregnanciesController,
    ContraceptivesController,
    NonGynSurgeriesController,
    PatientMedicationsController,
    NotesController,
  ],
  providers: [
    PatientAccessService,
    SnapshotService,
    AllergiesService,
    PregnanciesService,
    ContraceptivesService,
    NonGynSurgeriesService,
    PatientMedicationsService,
    NotesService,
  ],
  exports: [PatientAccessService],
})
export class PatientHistoryModule {}
