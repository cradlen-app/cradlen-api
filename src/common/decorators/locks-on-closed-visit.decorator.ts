import { SetMetadata } from '@nestjs/common';

/** Metadata key the EncounterMutationGuard reads to locate the visit ID. */
export const LOCKS_ON_CLOSED_VISIT_KEY = 'locks_on_closed_visit_param';

/**
 * Marks a controller method as a visit-scoped mutation that must be rejected
 * after `visit.status = COMPLETED` (or `CANCELLED`). The `paramName` arg names
 * the route parameter holding the visit UUID (default `'id'`).
 *
 * Pair with `@UseGuards(EncounterMutationGuard)` on the same handler or the
 * containing controller.
 *
 * Example:
 *   @Patch('visits/:visitId/pregnancy-record/cervix')
 *   @LocksOnClosedVisit('visitId')
 *   patchCervix(...) { ... }
 *
 * The amendment flow (`POST /v1/visits/:id/amendments`) is intentionally NOT
 * decorated — it's the structurally distinct path for editing closed visits.
 */
export const LocksOnClosedVisit = (paramName = 'id') =>
  SetMetadata(LOCKS_ON_CLOSED_VISIT_KEY, paramName);
