import { Module } from '@nestjs/common';
import { VisitsModule } from '@core/clinical/visits/visits.public';
import { PatientAccessModule } from '@core/patient/patient-access/patient-access.public';
import { ValidatorModule } from '@builder/validator/validator.module';
import { ObgynModule } from '../obgyn.module';
import { JourneyClinicalModule } from '../journeys/journey-clinical.module';
import { SurgicalActivationController } from './surgical-activation.controller';
import { SurgicalActivationService } from './surgical-activation.service';
import { SurgicalClinicalService } from './surgical-clinical.service';
import { SurgicalEpisodeRouterService } from './surgical-episode-router.service';
import { SurgicalVisitRoutingListener } from './surgical-visit-routing.listener';

/**
 * Surgical clinical vertical — activates the journey-centric chart for the
 * OBGYN_SURGICAL care path (the second live journey surface, after pregnancy).
 * Imports VisitsModule for the EncounterMutationGuard, PatientAccessModule for
 * org-scope gating, ValidatorModule for template-driven PATCH validation,
 * ObgynModule for ObgynHistoryService (the linked patient-history summary), and
 * JourneyClinicalModule for the shared clinical-surface dispatcher/registry (the
 * SurgicalClinicalService self-registers as the OBGYN_SURGICAL handler).
 * `SurgicalVisitRoutingListener` reacts to `visit.booked` to route surgical
 * visits into their phase episode (booking lives in core and can't call here).
 */
@Module({
  imports: [
    VisitsModule,
    PatientAccessModule,
    ValidatorModule,
    ObgynModule,
    JourneyClinicalModule,
  ],
  controllers: [SurgicalActivationController],
  providers: [
    SurgicalClinicalService,
    SurgicalActivationService,
    SurgicalEpisodeRouterService,
    SurgicalVisitRoutingListener,
  ],
})
export class SurgicalModule {}
