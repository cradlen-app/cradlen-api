import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { EncounterMutationGuard } from './encounter-mutation.guard';

@Module({
  controllers: [VisitsController],
  providers: [VisitsService, EncounterMutationGuard],
  exports: [EncounterMutationGuard],
})
export class VisitsModule {}
