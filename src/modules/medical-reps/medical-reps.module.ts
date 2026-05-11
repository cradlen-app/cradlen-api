import { Module } from '@nestjs/common';
import { MedicalRepsController } from './medical-reps.controller';
import { MedicalRepsService } from './medical-reps.service';

@Module({
  controllers: [MedicalRepsController],
  providers: [MedicalRepsService],
  exports: [MedicalRepsService],
})
export class MedicalRepsModule {}
