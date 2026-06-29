import { Module } from '@nestjs/common';
import { VisitsModule } from '@core/clinical/visits/visits.public';
import { JourneyClinicalController } from './journey-clinical.controller';
import { JourneyClinicalRegistry } from './journey-clinical.registry';

/**
 * Owns the single generic journey clinical-surface route + the surface-handler
 * registry. Surface verticals (pregnancy, surgical) import this module and
 * self-register their handler on init. Imports VisitsModule for the
 * `EncounterMutationGuard` (closed-visit lock).
 */
@Module({
  imports: [VisitsModule],
  controllers: [JourneyClinicalController],
  providers: [JourneyClinicalRegistry],
  exports: [JourneyClinicalRegistry],
})
export class JourneyClinicalModule {}
