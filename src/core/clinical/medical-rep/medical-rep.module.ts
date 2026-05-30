import { Module } from '@nestjs/common';
import { MedicalRepController } from './medical-rep.controller';
import { MedicalRepService } from './medical-rep.service';
import { MedicalRepVisitService } from './medical-rep-visit.service';
import { ValidatorModule } from '@builder/validator/validator.module.js';

@Module({
  imports: [ValidatorModule],
  controllers: [MedicalRepController],
  providers: [MedicalRepService, MedicalRepVisitService],
  exports: [MedicalRepService, MedicalRepVisitService],
})
export class MedicalRepModule {}
