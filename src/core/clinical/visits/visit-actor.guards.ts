import { ForbiddenException } from '@nestjs/common';
import { AuthContext } from '@common/interfaces/auth-context.interface';

const RECEPTIONIST_JOB_FUNCTION = 'RECEPTIONIST';

/** OWNER / BRANCH_MANAGER / SYSTEM may drive any visit action. */
export function isPrivileged(user: AuthContext): boolean {
  return (
    user.roles.includes('OWNER') ||
    user.roles.includes('BRANCH_MANAGER') ||
    user.roles.includes('SYSTEM')
  );
}

/**
 * Front-desk actions — booking a visit and the reception-driven status
 * transitions (check-in, cancel, no-show). Restricted to receptionists, with
 * an owner/branch-manager override.
 */
export function assertReceptionAction(
  user: AuthContext,
  message: string,
): void {
  if (isPrivileged(user)) return;
  if (user.jobFunctions.includes(RECEPTIONIST_JOB_FUNCTION)) return;
  throw new ForbiddenException(message);
}

/**
 * Clinical actions — starting the consultation (IN_CONSULTATION) and
 * completing (COMPLETED) a visit may only be done by the doctor the visit was
 * booked for, with an owner/branch-manager override. A receptionist (or any
 * other doctor) cannot start or complete a visit they were not assigned.
 */
export function assertAssignedDoctor(
  assignedDoctorId: string,
  user: AuthContext,
): void {
  if (isPrivileged(user)) return;
  if (assignedDoctorId === user.profileId) return;
  throw new ForbiddenException(
    'Only the assigned doctor can start or complete this visit',
  );
}
