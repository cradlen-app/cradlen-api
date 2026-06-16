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

export async function syncProfileSpecialties(
  tx: Prisma.TransactionClient,
  profileId: string,
  nextSpecialtyIds: string[],
): Promise<void> {
  const current = await tx.profileSpecialty.findMany({
    where: { profile_id: profileId },
    select: { specialty_id: true },
  });
  const { toAdd, toRemove } = diffIds(
    current.map((r) => r.specialty_id),
    nextSpecialtyIds,
  );
  if (toRemove.length) {
    await tx.profileSpecialty.deleteMany({
      where: { profile_id: profileId, specialty_id: { in: toRemove } },
    });
  }
  if (toAdd.length) {
    await tx.profileSpecialty.createMany({
      data: toAdd.map((specialty_id) => ({
        profile_id: profileId,
        specialty_id,
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

export async function replaceProfileSpecialties(
  tx: Prisma.TransactionClient,
  profileId: string,
  specialtyIds: string[],
): Promise<void> {
  await tx.profileSpecialty.deleteMany({ where: { profile_id: profileId } });
  if (!specialtyIds.length) return;
  await tx.profileSpecialty.createMany({
    data: specialtyIds.map((specialty_id) => ({
      profile_id: profileId,
      specialty_id,
    })),
  });
}
