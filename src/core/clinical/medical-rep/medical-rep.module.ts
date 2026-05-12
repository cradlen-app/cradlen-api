import { Module } from '@nestjs/common';
import { MedicalRepController } from './medical-rep.controller';
import { MedicalRepService } from './medical-rep.service';

@Module({
  controllers: [MedicalRepController],
  providers: [MedicalRepService],
  exports: [MedicalRepService],
})
export class MedicalRepModule {}
