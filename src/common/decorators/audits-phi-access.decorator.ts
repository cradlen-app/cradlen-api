import { SetMetadata } from '@nestjs/common';

/** Metadata key the PhiAuditInterceptor reads to build the access record. */
export const AUDITS_PHI_ACCESS_KEY = 'audits_phi_access';

export type PhiSubjectType = 'PATIENT' | 'VISIT';

export interface AuditsPhiAccessOptions {
  /** Logical surface tag, e.g. `'patient.detail'`, `'portal.journey'`. */
  resource: string;
  /**
   * Access purpose under the minimum-necessary principle
   * (`'treatment' | 'payment' | 'operations' | 'patient_self'`).
   */
  purpose?: string;
  /**
   * Where the audited subject id comes from:
   *  - `'route'` (default): a route parameter — staff-facing routes.
   *  - `'self'`: the authenticated patient's own record — portal routes,
   *    where no id is present in the path.
   */
  subject?: 'route' | 'self';
  /** Route param holding the subject id when `subject: 'route'` (default `'id'`). */
  param?: string;
  /** What the param id refers to when `subject: 'route'` (default `'PATIENT'`). */
  subjectType?: PhiSubjectType;
}

/**
 * Marks a read handler as touching patient PHI so `PhiAuditInterceptor` records
 * a durable who-viewed-which-patient row (HIPAA §164.312(b)). The write happens
 * on the success path only, off the request's critical path (never blocks or
 * fails the response).
 *
 * Staff route (id in the path):
 *   @Get('/patients/:id')
 *   @AuditsPhiAccess({ resource: 'patient.detail', purpose: 'treatment' })
 *
 * Visit-scoped staff route (param holds a visit id):
 *   @Get('/visits/:visitId/examination')
 *   @AuditsPhiAccess({ resource: 'visit.examination', param: 'visitId', subjectType: 'VISIT' })
 *
 * Patient-portal self-read (no id in the path):
 *   @Get()
 *   @AuditsPhiAccess({ resource: 'portal.journey', purpose: 'patient_self', subject: 'self' })
 */
export const AuditsPhiAccess = (options: AuditsPhiAccessOptions) =>
  SetMetadata(AUDITS_PHI_ACCESS_KEY, options);
