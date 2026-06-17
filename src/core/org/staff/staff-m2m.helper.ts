import { Prisma } from '@prisma/client';

/**
 * Returns the symmetric difference of `current` and `next`:
 *  - `toAdd`: in `next` but not in `current`
 *  - `toRemove`: in `current` but not in `next`
 */
export function diffIds(
  current: string[],
  next: string[],
): { toAdd: string[]; toRemove: string[] } {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return {
    toAdd: next.filter((id) => !currentSet.has(id)),
    toRemove: current.filter((id) => !nextSet.has(id)),
  };
}

export async function syncProfileBranches(
  tx: Prisma.TransactionClient,
  profileId: string,
  organizationId: string,
  nextBranchIds: string[],
): Promise<void> {
  const current = await tx.profileBranch.findMany({
    where: { profile_id: profileId },
    select: { branch_id: true },
  });
  const { toAdd, toRemove } = diffIds(
    current.map((r) => r.branch_id),
    nextBranchIds,
  );
  if (toRemove.length) {
    await tx.profileBranch.deleteMany({
      where: { profile_id: profileId, branch_id: { in: toRemove } },
    });
  }
  if (toAdd.length) {
    await tx.profileBranch.createMany({
      data: toAdd.map((branch_id) => ({
        profile_id: profileId,
        branch_id,
        organization_id: organizationId,
      })),
    });
  }
}

export async function syncProfileSubspecialties(
  tx: Prisma.TransactionClient,
  profileId: string,
  nextSubspecialtyIds: string[],
): Promise<void> {
  const current = await tx.profileSubspecialty.findMany({
    where: { profile_id: profileId },
    select: { subspecialty_id: true },
  });
  const { toAdd, toRemove } = diffIds(
    current.map((r) => r.subspecialty_id),
    nextSubspecialtyIds,
  );
  if (toRemove.length) {
    await tx.profileSubspecialty.deleteMany({
      where: { profile_id: profileId, subspecialty_id: { in: toRemove } },
    });
  }
  if (toAdd.length) {
    await tx.profileSubspecialty.createMany({
      data: toAdd.map((subspecialty_id) => ({
        profile_id: profileId,
        subspecialty_id,
      })),
    });
  }
}

export async function replaceProfileBranches(
  tx: Prisma.TransactionClient,
  profileId: string,
  organizationId: string,
  branchIds: string[],
): Promise<void> {
  await tx.profileBranch.deleteMany({ where: { profile_id: profileId } });
  if (!branchIds.length) return;
  await tx.profileBranch.createMany({
    data: branchIds.map((branch_id) => ({
      profile_id: profileId,
      branch_id,
      organization_id: organizationId,
    })),
  });
}

export async function replaceProfileSubspecialties(
  tx: Prisma.TransactionClient,
  profileId: string,
  subspecialtyIds: string[],
): Promise<void> {
  await tx.profileSubspecialty.deleteMany({ where: { profile_id: profileId } });
  if (!subspecialtyIds.length) return;
  await tx.profileSubspecialty.createMany({
    data: subspecialtyIds.map((subspecialty_id) => ({
      profile_id: profileId,
      subspecialty_id,
    })),
  });
}
