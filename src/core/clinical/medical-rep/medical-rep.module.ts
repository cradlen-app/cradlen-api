import { Module } from '@nestjs/common';
import { MedicalRepController } from './medical-rep.controller';
import { MedicalRepService } from './medical-rep.service';
import { MedicalRepVisitService } from './medical-rep-visit.service';
import { MedicalRepVisitExaminationController } from './visit-examination/medical-rep-visit-examination.controller';
import { MedicalRepVisitExaminationService } from './visit-examination/medical-rep-visit-examination.service';
import { ValidatorModule } from '@builder/validator/validator.module.js';

@Module({
  imports: [ValidatorModule],
  controllers: [MedicalRepController, MedicalRepVisitExaminationController],
  providers: [
    MedicalRepService,
    MedicalRepVisitService,
    MedicalRepVisitExaminationService,
  ],
  exports: [MedicalRepService, MedicalRepVisitService],
})
export class MedicalRepModule {}
