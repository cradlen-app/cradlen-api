import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { EncounterMutationGuard } from './encounter-mutation.guard';
import { ValidatorModule } from '@builder/validator/validator.module.js';

@Module({
  imports: [ValidatorModule],
  controllers: [VisitsController],
  providers: [VisitsService, EncounterMutationGuard],
  exports: [EncounterMutationGuard],
})
export class VisitsModule {}
