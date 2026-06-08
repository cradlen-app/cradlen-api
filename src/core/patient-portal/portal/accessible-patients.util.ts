import { NotFoundException } from '@nestjs/common';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';

/**
 * Resolves which patient ids a portal request may read. With no explicit
 * `patientId` the caller gets every patient they may access (their own record,
 * or — for a guardian — all linked patients). When a `patientId` IS supplied it
 * must be one of those, else we throw a generic 404 — never reveal another
 * patient's existence.
 */
export function resolveAccessiblePatientIds(
  ctx: PatientAuthContext,
  patientId?: string,
): string[] {
  if (!patientId) return ctx.accessiblePatientIds;
  if (!ctx.accessiblePatientIds.includes(patientId)) {
    throw new NotFoundException('No matching record found');
  }
  return [patientId];
}
