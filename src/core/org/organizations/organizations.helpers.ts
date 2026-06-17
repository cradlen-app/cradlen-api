import type {
  Branch,
  Organization,
  Prisma,
  Profile,
  Specialty,
} from '@prisma/client';
import type { CreateOrganizationDto } from './dto/create-organization.dto.js';

export interface ProvisionOrganizationArgs {
  userId: string;
  dto: CreateOrganizationDto;
  ownerRoleId: string;
  freePlanId: string;
  trialEndsAt: Date;
  specialties: Specialty[];
}

export interface ProvisionOrganizationResult {
  organization: Organization;
  branch: Branch;
  profile: Profile;
}

/**
 * Creates the four rows that bootstrap a tenant: Organization (+ specialty
 * links), main Branch, OWNER Profile, and a free-trial Subscription. Must run
 * inside a caller-owned `$transaction` so the bootstrap is atomic. The owner's
 * own primary specialty is not set here (this flow has no practitioner field) —
 * it is assigned later via the staff/profile edit surfaces.
 *
 * NOTE: `SignupService.runOnboardingTransaction` inlines the same four inserts
 * plus an atomic onboarding-claim. Consolidating the two onto this helper is the
 * remaining cross-module dedup target.
 */
export async function provisionOrganization(
  tx: Prisma.TransactionClient,
  args: ProvisionOrganizationArgs,
): Promise<ProvisionOrganizationResult> {
  const { userId, dto, ownerRoleId, freePlanId, trialEndsAt, specialties } =
    args;

  const specialtyCreate = specialties.length
    ? { create: specialties.map((s) => ({ specialty_id: s.id })) }
    : undefined;

  const organization = await tx.organization.create({
    data: {
      name: dto.organization_name,
      specialty_links: specialtyCreate,
    },
  });

  const branch = await tx.branch.create({
    data: {
      organization_id: organization.id,
      name: dto.branch_name,
      address: dto.branch_address,
      city: dto.branch_city,
      governorate: dto.branch_governorate,
      country: dto.branch_country,
      is_main: true,
    },
  });

  const profile = await tx.profile.create({
    data: {
      user_id: userId,
      organization_id: organization.id,
      role_id: ownerRoleId,
      branches: {
        create: { branch_id: branch.id, organization_id: organization.id },
      },
    },
  });

  await tx.subscription.create({
    data: {
      organization_id: organization.id,
      subscription_plan_id: freePlanId,
      trial_ends_at: trialEndsAt,
    },
  });

  return { organization, branch, profile };
}
