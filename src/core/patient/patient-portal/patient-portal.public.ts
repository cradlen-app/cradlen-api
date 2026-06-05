/**
 * Public surface of the patient-portal module for sibling layers.
 *
 * The OB/GYN specialty layer mounts its own patient-portal read endpoint
 * (`GET /v1/patient-portal/obgyn-history`) and reuses the same accessible-patient
 * 404-gate the core portal endpoints use. Exposed here so specialties import core
 * via a `*.public.ts` per the cross-layer convention (don't duplicate the gate).
 */
export { resolveAccessiblePatientIds } from './accessible-patients.util.js';
