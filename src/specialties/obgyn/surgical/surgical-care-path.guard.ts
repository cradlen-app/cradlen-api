import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODES } from '@common/constant/error-codes';

export const SURGICAL_CARE_PATH_CODE = 'OBGYN_SURGICAL';

/**
 * Once a surgical profile is ACTIVE on a journey, that journey's care path is
 * committed: it must be CLOSED (outcome recorded) before any other care path can
 * start — the single-active-journey invariant makes surgery sequential, never
 * concurrent.
 *
 * No-op when re-selecting surgical (idempotent) or when no active surgical
 * profile exists. Throws `409 SURGICAL_ACTIVE` otherwise. Runs inside the
 * caller's transaction.
 */
export async function assertSurgicalCarePathChangeAllowed(
  tx: Prisma.TransactionClient,
  journeyId: string,
  newCarePathCode: string,
): Promise<void> {
  if (newCarePathCode === SURGICAL_CARE_PATH_CODE) return;
  const active = await tx.surgicalJourneyRecord.findFirst({
    where: { journey_id: journeyId, status: 'ACTIVE', is_deleted: false },
    select: { id: true },
  });
  if (!active) return;
  throw new ConflictException({
    code: ERROR_CODES.SURGICAL_ACTIVE,
    message:
      'An active surgical journey is open. Close it (record the outcome) before starting another care path.',
    details: {
      journey_id: journeyId,
      close_endpoint: '/v1/visits/:visitId/surgical/close',
    },
  });
}
