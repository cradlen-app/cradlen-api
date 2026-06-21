import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODES } from '@common/constant/error-codes';

export const PREGNANCY_CARE_PATH_CODE = 'OBGYN_PREGNANCY';

/**
 * Once a pregnancy profile is ACTIVE on a journey, that journey's care path is
 * committed: it must be CLOSED (delivery/outcome recorded) before any other
 * care path can start — the single-active-journey invariant makes pregnancy and
 * e.g. a surgery sequential, never concurrent. A Cesarean is recorded as the
 * delivery outcome at close, not as a separate care path.
 *
 * No-op when re-selecting pregnancy (idempotent) or when no active pregnancy
 * exists (a provisional OBGYN_GENERAL journey reclassifies freely). Throws
 * `409 PREGNANCY_ACTIVE` otherwise. Runs inside the caller's transaction.
 */
export async function assertCarePathChangeAllowed(
  tx: Prisma.TransactionClient,
  journeyId: string,
  newCarePathCode: string,
): Promise<void> {
  if (newCarePathCode === PREGNANCY_CARE_PATH_CODE) return;
  const active = await tx.pregnancyJourneyRecord.findFirst({
    where: { journey_id: journeyId, status: 'ACTIVE', is_deleted: false },
    select: { id: true },
  });
  if (!active) return;
  throw new ConflictException({
    code: ERROR_CODES.PREGNANCY_ACTIVE,
    message:
      'An active pregnancy is open on this journey. Close it (record the delivery/outcome) before starting another care path.',
    details: {
      journey_id: journeyId,
      close_endpoint: '/v1/visits/:visitId/pregnancy/close',
    },
  });
}
