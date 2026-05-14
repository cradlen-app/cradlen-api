import { Module } from '@nestjs/common';
import { MedicalRepController } from './medical-rep.controller';
import { MedicalRepService } from './medical-rep.service';
import { ValidatorModule } from '@builder/validator/validator.module.js';

@Module({
  imports: [ValidatorModule],
  controllers: [MedicalRepController],
  providers: [MedicalRepService],
  exports: [MedicalRepService],
})
export class MedicalRepModule {}
