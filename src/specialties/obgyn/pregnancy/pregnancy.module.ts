import { Module } from '@nestjs/common';
import { VisitsModule } from '@core/clinical/visits/visits.public';
import { PatientAccessModule } from '@core/patient/patient-access/patient-access.public';
import { ValidatorModule } from '@builder/validator/validator.module';
import { ObgynModule } from '../obgyn.module';
import { JourneyClinicalModule } from '../journeys/journey-clinical.module';
import { PregnancyClinicalService } from './pregnancy-clinical.service';
import { PregnancyActivationController } from './pregnancy-activation.controller';
import { PregnancyActivationService } from './pregnancy-activation.service';
import { PregnancyEpisodeRouterService } from './pregnancy-episode-router.service';
import { PregnancyVisitRoutingListener } from './pregnancy-visit-routing.listener';

/**
 * Pregnancy clinical vertical — activates the journey-centric chart for the
 * OBGYN_PREGNANCY care path. Imports VisitsModule for the EncounterMutationGuard
 * (closed-visit lock), PatientAccessModule for org-scope gating, ValidatorModule
 * for the template-driven PATCH validation, and ObgynModule for
 * ObgynHistoryService (the patient blood group on the read-only summary).
 * `PregnancyVisitRoutingListener` reacts to `visit.booked` to route pregnancy
 * visits into their trimester episode (booking lives in core and can't call here).
 */
@Module({
  imports: [
    VisitsModule,
    PatientAccessModule,
    ValidatorModule,
    ObgynModule,
    JourneyClinicalModule,
  ],
  controllers: [PregnancyActivationController],
  providers: [
    PregnancyClinicalService,
    PregnancyActivationService,
    PregnancyEpisodeRouterService,
    PregnancyVisitRoutingListener,
  ],
})
export class PregnancyModule {}
