import { Module } from '@nestjs/common';
import { DiagnosisCodesController } from './diagnosis-codes.controller';
import { DiagnosisCodesService } from './diagnosis-codes.service';

@Module({
  controllers: [DiagnosisCodesController],
  providers: [DiagnosisCodesService],
  exports: [DiagnosisCodesService],
})
export class DiagnosisCodesModule {}
