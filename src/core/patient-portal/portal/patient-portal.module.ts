import { Module } from '@nestjs/common';
import { PatientProfileModule } from './profile/patient-profile.module.js';
import { PatientMedicationsModule } from './medications/patient-medications.module.js';
import { PatientVisitsModule } from './visits/patient-visits.module.js';
import { PatientInvestigationsModule } from './investigations/patient-investigations.module.js';

/**
 * Patient-facing portal surface (authenticated via the `patient-jwt` strategy
 * registered by PatientAuthModule). Thin aggregator over the per-feature
 * modules: profile settings, medications, visit history, and investigations
 * (with patient-uploaded result files on R2). The shared accessible-patient
 * 404-gate lives at this folder's root (accessible-patients.util.ts) and is
 * re-exported via patient-portal.public.ts for the OB/GYN specialty layer.
 */
@Module({
  imports: [
    PatientProfileModule,
    PatientMedicationsModule,
    PatientVisitsModule,
    PatientInvestigationsModule,
  ],
})
export class PatientPortalModule {}
