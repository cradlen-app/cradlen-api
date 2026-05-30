import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Asserts every id resolves to a live medication visible to the org (global or
 * own-org). Shared by the rep-medication link flow and the visit booking flow.
 */
export async function assertMedicationsExistInOrg(
  tx: Prisma.TransactionClient,
  ids: string[],
  organizationId: string,
): Promise<void> {
  const found = await tx.medication.findMany({
    where: {
      id: { in: ids },
      is_deleted: false,
      OR: [{ organization_id: null }, { organization_id: organizationId }],
    },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    const foundSet = new Set(found.map((m) => m.id));
    const missing = ids.filter((id) => !foundSet.has(id));
    throw new BadRequestException(
      `Unknown or cross-org medication_ids: ${missing.join(', ')}`,
    );
  }
}
