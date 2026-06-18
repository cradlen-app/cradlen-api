import type {
  Branch,
  EngagementType,
  ExecutiveTitle,
  Organization,
  Prisma,
  Profile,
  Specialty,
  Subspecialty,
} from '@prisma/client';
import type { CreateOrganizationDto } from './dto/create-organization.dto.js';

export interface ProvisionOrganizationArgs {
  userId: string;
  dto: CreateOrganizationDto;
  ownerRoleId: string;
  freePlanId: string;
  trialEndsAt: Date;
  specialties: Specialty[];
  /**
   * Owner-profile fields, set only when the owner also practices / holds a
   * title at this org. All optional — when omitted the profile is created
   * purely administrative (the original behavior).
   */
  owner?: {
    executiveTitle?: ExecutiveTitle | null;
    professionalTitle?: string | null;
    engagementType?: EngagementType;
    jobFunctionId?: string | null;
    practitionerSpecialtyId?: string | null;
    practitionerSubspecialties?: Subspecialty[];
  };
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
 * own primary specialty, job function, executive/professional titles and
 * subspecialties are set when provided via `args.owner` (only when the owner
 * also practices / holds a title); otherwise the profile is purely
 * administrative and those are assigned later via the staff/profile surfaces.
 *
 * NOTE: `SignupService.runOnboardingTransaction` inlines the same four inserts
 * plus an atomic onboarding-claim. Consolidating the two onto this helper is the
 * remaining cross-module dedup target.
 */
export async function provisionOrganization(
  tx: Prisma.TransactionClient,
  args: ProvisionOrganizationArgs,
): Promise<ProvisionOrganizationResult> {
  const {
    userId,
    dto,
    ownerRoleId,
    freePlanId,
    trialEndsAt,
    specialties,
    owner,
  } = args;

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

  const ownerSubspecialties = owner?.practitionerSubspecialties ?? [];
  const profile = await tx.profile.create({
    data: {
      user_id: userId,
      organization_id: organization.id,
      role_id: ownerRoleId,
      executive_title: owner?.executiveTitle ?? null,
      professional_title: owner?.professionalTitle ?? null,
      engagement_type: owner?.engagementType ?? 'FULL_TIME',
      job_function_id: owner?.jobFunctionId ?? null,
      // The owner's own primary specialty (only when they practice) —
      // distinct from the organization's offered specialties above.
      specialty_id: owner?.practitionerSpecialtyId ?? null,
      branches: {
        create: { branch_id: branch.id, organization_id: organization.id },
      },
      subspecialty_links: ownerSubspecialties.length
        ? {
            create: ownerSubspecialties.map((s) => ({
              subspecialty_id: s.id,
            })),
          }
        : undefined,
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
