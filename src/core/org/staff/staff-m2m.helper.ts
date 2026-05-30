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

export async function syncProfileRoles(
  tx: Prisma.TransactionClient,
  profileId: string,
  nextRoleIds: string[],
): Promise<void> {
  const current = await tx.profileRole.findMany({
    where: { profile_id: profileId },
    select: { role_id: true },
  });
  const { toAdd, toRemove } = diffIds(
    current.map((r) => r.role_id),
    nextRoleIds,
  );
  if (toRemove.length) {
    await tx.profileRole.deleteMany({
      where: { profile_id: profileId, role_id: { in: toRemove } },
    });
  }
  if (toAdd.length) {
    await tx.profileRole.createMany({
      data: toAdd.map((role_id) => ({ profile_id: profileId, role_id })),
    });
  }
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

export async function syncProfileJobFunctions(
  tx: Prisma.TransactionClient,
  profileId: string,
  nextJobFunctionIds: string[],
): Promise<void> {
  const current = await tx.profileJobFunction.findMany({
    where: { profile_id: profileId },
    select: { job_function_id: true },
  });
  const { toAdd, toRemove } = diffIds(
    current.map((r) => r.job_function_id),
    nextJobFunctionIds,
  );
  if (toRemove.length) {
    await tx.profileJobFunction.deleteMany({
      where: { profile_id: profileId, job_function_id: { in: toRemove } },
    });
  }
  if (toAdd.length) {
    await tx.profileJobFunction.createMany({
      data: toAdd.map((job_function_id) => ({
        profile_id: profileId,
        job_function_id,
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

export async function replaceProfileRoles(
  tx: Prisma.TransactionClient,
  profileId: string,
  roleIds: string[],
): Promise<void> {
  await tx.profileRole.deleteMany({ where: { profile_id: profileId } });
  if (!roleIds.length) return;
  await tx.profileRole.createMany({
    data: roleIds.map((role_id) => ({ profile_id: profileId, role_id })),
  });
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

export async function replaceProfileJobFunctions(
  tx: Prisma.TransactionClient,
  profileId: string,
  jobFunctionIds: string[],
): Promise<void> {
  await tx.profileJobFunction.deleteMany({ where: { profile_id: profileId } });
  if (!jobFunctionIds.length) return;
  await tx.profileJobFunction.createMany({
    data: jobFunctionIds.map((job_function_id) => ({
      profile_id: profileId,
      job_function_id,
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
