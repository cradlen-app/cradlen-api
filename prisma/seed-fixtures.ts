/**
 * Seed fixtures: builds the three real-world organizations described in the
 * Multi-Org Healthcare Model Refactor plan. NEVER run against production —
 * deterministic test emails (*.test) and a shared default password are used.
 *
 * Idempotent: safe to re-run. Uses upsert/findFirst to avoid duplicates.
 *
 * Usage:
 *   npm run seed:fixtures
 *
 * Verifies the new model end-to-end:
 *   - Per-org profiles for the same User (Mervat, Elsayed)
 *   - executive_title (CEO/COO/CFO at amshag)
 *   - engagement_type (ON_DEMAND for cross-org pediatrician)
 *   - JobFunction-based staff differentiation
 *   - Procedure-linked surgery calendar event
 */
import { config } from 'dotenv';
import { PrismaNeon } from '@prisma/adapter-neon';
import {
  PrismaClient,
  type EngagementType,
  type ExecutiveTitle,
  type Prisma,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

config({ path: '.env' });
config({
  path: `.env.${process.env.NODE_ENV ?? 'development'}`,
  override: true,
});

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const DEFAULT_PASSWORD = 'TestPass123!';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-fixtures must not run in production');
  }

  console.log('Resolving reference data…');
  const refs = await loadReferenceData();
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

  console.log('Building jasmin…');
  const jasminContext = await buildJasmin(refs, passwordHash);

  console.log('Building janah…');
  const janahContext = await buildJanah(refs, passwordHash);

  console.log('Building amshag…');
  await buildAmshag(refs, passwordHash);

  console.log('Adding cross-org links (Mervat → amshag, Elsayed → jasmin/janah)…');
  await addCrossOrgLinks(refs, passwordHash, jasminContext, janahContext);

  console.log('Creating sample C-section calendar event at jasmin…');
  await createSampleCSection(refs, jasminContext);

  console.log('Done.');
  console.log(
    `\nDefault password for every seeded user: ${DEFAULT_PASSWORD}\n` +
      `Test emails follow the pattern <role>.<n>@<org>.test (or named accounts like dr.yehia@amshag.test).\n`,
  );
}

// ---- Reference data ---------------------------------------------------------

interface RefData {
  roles: { OWNER: string; STAFF: string; EXTERNAL: string };
  jobFunctions: Record<JobFunctionCode, string>;
  specialties: { GYN: string };
  procedures: { CESAREAN_SECTION: string };
  plans: { free_trial: string; plus: string; pro: string; enterprise: string };
}

type JobFunctionCode =
  | 'OBGYN'
  | 'ANESTHESIOLOGIST'
  | 'PEDIATRICIAN'
  | 'OTHER_DOCTOR'
  | 'NURSE'
  | 'ASSISTANT'
  | 'RECEPTIONIST'
  | 'ACCOUNTANT';

async function loadReferenceData(): Promise<RefData> {
  const [
    ownerRole,
    staffRole,
    externalRole,
    jobFunctionRows,
    gynSpecialty,
    cesareanProcedure,
    freeTrialPlan,
    plusPlan,
    proPlan,
    enterprisePlan,
  ] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { name: 'OWNER' } }),
    prisma.role.findUniqueOrThrow({ where: { name: 'STAFF' } }),
    prisma.role.findUniqueOrThrow({ where: { name: 'EXTERNAL' } }),
    prisma.jobFunction.findMany(),
    prisma.specialty.findUniqueOrThrow({ where: { code: 'GYN' } }),
    prisma.procedure.findUniqueOrThrow({ where: { code: 'CESAREAN_SECTION' } }),
    prisma.subscriptionPlan.findUniqueOrThrow({ where: { plan: 'free_trial' } }),
    prisma.subscriptionPlan.findUniqueOrThrow({ where: { plan: 'plus' } }),
    prisma.subscriptionPlan.findUniqueOrThrow({ where: { plan: 'pro' } }),
    prisma.subscriptionPlan.findUniqueOrThrow({ where: { plan: 'enterprise' } }),
  ]);

  const jobFunctions = Object.fromEntries(
    jobFunctionRows.map((jf) => [jf.code, jf.id]),
  ) as Record<JobFunctionCode, string>;

  return {
    roles: { OWNER: ownerRole.id, STAFF: staffRole.id, EXTERNAL: externalRole.id },
    jobFunctions,
    specialties: { GYN: gynSpecialty.id },
    procedures: { CESAREAN_SECTION: cesareanProcedure.id },
    plans: {
      free_trial: freeTrialPlan.id,
      plus: plusPlan.id,
      pro: proPlan.id,
      enterprise: enterprisePlan.id,
    },
  };
}

// ---- Helpers ----------------------------------------------------------------

interface UserSpec {
  email: string;
  first_name: string;
  last_name: string;
}

async function ensureUser(spec: UserSpec, passwordHash: string) {
  const existing = await prisma.user.findUnique({ where: { email: spec.email } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      email: spec.email,
      first_name: spec.first_name,
      last_name: spec.last_name,
      password_hashed: passwordHash,
      verified_at: new Date(),
      registration_status: 'ACTIVE',
      onboarding_completed: true,
      is_active: true,
    },
  });
}

async function ensureOrganization(name: string) {
  const existing = await prisma.organization.findFirst({
    where: { name, is_deleted: false },
  });
  if (existing) return existing;
  return prisma.organization.create({
    data: { name, specialities: ['Gynecology'] },
  });
}

async function ensureOrganizationSpecialty(
  organizationId: string,
  specialtyId: string,
) {
  await prisma.organizationSpecialty.upsert({
    where: {
      organization_id_specialty_id: {
        organization_id: organizationId,
        specialty_id: specialtyId,
      },
    },
    update: {},
    create: { organization_id: organizationId, specialty_id: specialtyId },
  });
}

async function ensureBranch(
  organizationId: string,
  spec: {
    name: string;
    city: string;
    governorate: string;
    address: string;
    is_main: boolean;
  },
) {
  const existing = await prisma.branch.findFirst({
    where: {
      organization_id: organizationId,
      name: spec.name,
      is_deleted: false,
    },
  });
  if (existing) return existing;
  return prisma.branch.create({
    data: {
      organization_id: organizationId,
      name: spec.name,
      city: spec.city,
      governorate: spec.governorate,
      address: spec.address,
      country: 'Egypt',
      is_main: spec.is_main,
    },
  });
}

async function ensureSubscription(organizationId: string, planId: string) {
  const existing = await prisma.subscription.findFirst({
    where: { organization_id: organizationId, is_deleted: false },
  });
  if (existing) return existing;
  return prisma.subscription.create({
    data: {
      organization_id: organizationId,
      subscription_plan_id: planId,
      status: 'ACTIVE',
    },
  });
}

interface ProfileSpec {
  userId: string;
  organizationId: string;
  roleIds: string[];
  jobFunctionIds: string[];
  branchIds: string[];
  specialtyIds?: string[];
  executive_title?: ExecutiveTitle | null;
  engagement_type?: EngagementType;
}

async function ensureProfile(spec: ProfileSpec) {
  const profile = await prisma.profile.upsert({
    where: {
      user_id_organization_id: {
        user_id: spec.userId,
        organization_id: spec.organizationId,
      },
    },
    update: {
      is_active: true,
      is_deleted: false,
      executive_title: spec.executive_title ?? null,
      engagement_type: spec.engagement_type ?? 'FULL_TIME',
    },
    create: {
      user_id: spec.userId,
      organization_id: spec.organizationId,
      executive_title: spec.executive_title ?? null,
      engagement_type: spec.engagement_type ?? 'FULL_TIME',
    },
  });

  await Promise.all([
    ...spec.roleIds.map((role_id) =>
      prisma.profileRole.upsert({
        where: { profile_id_role_id: { profile_id: profile.id, role_id } },
        update: {},
        create: { profile_id: profile.id, role_id },
      }),
    ),
    ...spec.jobFunctionIds.map((job_function_id) =>
      prisma.profileJobFunction.upsert({
        where: {
          profile_id_job_function_id: {
            profile_id: profile.id,
            job_function_id,
          },
        },
        update: {},
        create: { profile_id: profile.id, job_function_id },
      }),
    ),
    ...spec.branchIds.map((branch_id) =>
      prisma.profileBranch.upsert({
        where: {
          profile_id_branch_id: { profile_id: profile.id, branch_id },
        },
        update: {},
        create: {
          profile_id: profile.id,
          branch_id,
          organization_id: spec.organizationId,
        },
      }),
    ),
    ...(spec.specialtyIds ?? []).map((specialty_id) =>
      prisma.profileSpecialty.upsert({
        where: {
          profile_id_specialty_id: { profile_id: profile.id, specialty_id },
        },
        update: {},
        create: { profile_id: profile.id, specialty_id },
      }),
    ),
  ]);

  return profile;
}

async function ensureStandardSchedule(profileId: string, branchId: string) {
  // Mon–Fri, 09:00–17:00. Skip if a schedule for this (profile, branch) exists.
  const existing = await prisma.workingSchedule.findUnique({
    where: { profile_id_branch_id: { profile_id: profileId, branch_id: branchId } },
  });
  if (existing) return existing;
  return prisma.workingSchedule.create({
    data: {
      profile_id: profileId,
      branch_id: branchId,
      days: {
        create: (['MON', 'TUE', 'WED', 'THU', 'FRI'] as const).map((day) => ({
          day_of_week: day,
          shifts: { create: [{ start_time: '09:00', end_time: '17:00' }] },
        })),
      },
    },
  });
}

// ---- jasmin -----------------------------------------------------------------

interface OrgContext {
  organizationId: string;
  branches: Record<string, string>; // city → branch_id
  ownerProfileId: string;
}

async function buildJasmin(refs: RefData, passwordHash: string): Promise<OrgContext> {
  const org = await ensureOrganization('jasmin');
  await ensureSubscription(org.id, refs.plans.plus);
  await ensureOrganizationSpecialty(org.id, refs.specialties.GYN);

  const sohag = await ensureBranch(org.id, {
    name: 'Sohag Branch',
    city: 'Sohag',
    governorate: 'Sohag',
    address: '12 El-Geish St, Sohag',
    is_main: true,
  });
  const elmaragha = await ensureBranch(org.id, {
    name: 'Elmaragha Branch',
    city: 'Elmaragha',
    governorate: 'Sohag',
    address: '5 Main Rd, Elmaragha',
    is_main: false,
  });
  const branchIds = [sohag.id, elmaragha.id];

  const ownerUser = await ensureUser(
    { email: 'dr.ahmed.hassan@jasmin.test', first_name: 'Ahmed', last_name: 'Hassan' },
    passwordHash,
  );
  const ownerProfile = await ensureProfile({
    userId: ownerUser.id,
    organizationId: org.id,
    roleIds: [refs.roles.OWNER],
    jobFunctionIds: [refs.jobFunctions.OBGYN],
    branchIds,
    specialtyIds: [refs.specialties.GYN],
  });
  for (const b of branchIds) await ensureStandardSchedule(ownerProfile.id, b);

  await seedStaff(refs, org.id, branchIds, passwordHash, 'jasmin', {
    ANESTHESIOLOGIST: 1,
    PEDIATRICIAN: 1,
    ASSISTANT: 2,
    NURSE: 1,
    RECEPTIONIST: 2,
  });

  return {
    organizationId: org.id,
    branches: { Sohag: sohag.id, Elmaragha: elmaragha.id },
    ownerProfileId: ownerProfile.id,
  };
}

// ---- janah ------------------------------------------------------------------

async function buildJanah(refs: RefData, passwordHash: string): Promise<OrgContext> {
  const org = await ensureOrganization('janah');
  await ensureSubscription(org.id, refs.plans.plus);
  await ensureOrganizationSpecialty(org.id, refs.specialties.GYN);

  const elmaragha = await ensureBranch(org.id, {
    name: 'Elmaragha Branch',
    city: 'Elmaragha',
    governorate: 'Sohag',
    address: '22 Central St, Elmaragha',
    is_main: true,
  });
  const branchIds = [elmaragha.id];

  const ownerUser = await ensureUser(
    {
      email: 'dr.mervat.fathallah@janah.test',
      first_name: 'Mervat',
      last_name: 'Fathallah',
    },
    passwordHash,
  );
  const ownerProfile = await ensureProfile({
    userId: ownerUser.id,
    organizationId: org.id,
    roleIds: [refs.roles.OWNER],
    jobFunctionIds: [refs.jobFunctions.OBGYN],
    branchIds,
    specialtyIds: [refs.specialties.GYN],
  });
  for (const b of branchIds) await ensureStandardSchedule(ownerProfile.id, b);

  await seedStaff(refs, org.id, branchIds, passwordHash, 'janah', {
    ANESTHESIOLOGIST: 2,
    PEDIATRICIAN: 2,
    ASSISTANT: 2,
    NURSE: 1,
    RECEPTIONIST: 2,
  });

  return {
    organizationId: org.id,
    branches: { Elmaragha: elmaragha.id },
    ownerProfileId: ownerProfile.id,
  };
}

// ---- amshag -----------------------------------------------------------------

async function buildAmshag(refs: RefData, passwordHash: string): Promise<OrgContext> {
  const org = await ensureOrganization('amshag');
  await ensureSubscription(org.id, refs.plans.enterprise);
  await ensureOrganizationSpecialty(org.id, refs.specialties.GYN);

  const hq = await ensureBranch(org.id, {
    name: 'HQ Branch',
    city: 'Sohag',
    governorate: 'Sohag',
    address: '1 HQ Avenue, Sohag',
    is_main: true,
  });
  const east = await ensureBranch(org.id, {
    name: 'East Branch',
    city: 'Akhmim',
    governorate: 'Sohag',
    address: '14 East Rd, Akhmim',
    is_main: false,
  });
  const south = await ensureBranch(org.id, {
    name: 'South Branch',
    city: 'Tahta',
    governorate: 'Sohag',
    address: '8 South St, Tahta',
    is_main: false,
  });
  const branchIds = [hq.id, east.id, south.id];

  // Three owners with C-suite titles
  const owners: Array<{
    user: UserSpec;
    title: ExecutiveTitle;
  }> = [
    {
      user: { email: 'dr.yehia@amshag.test', first_name: 'Mohamed', last_name: 'Yehia' },
      title: 'CEO',
    },
    {
      user: { email: 'dr.sabry@amshag.test', first_name: 'Mohamed', last_name: 'Sabry' },
      title: 'COO',
    },
    {
      user: { email: 'dr.esmail@amshag.test', first_name: 'Ahmed', last_name: 'Esmail' },
      title: 'CFO',
    },
  ];

  for (const { user, title } of owners) {
    const u = await ensureUser(user, passwordHash);
    const p = await ensureProfile({
      userId: u.id,
      organizationId: org.id,
      roleIds: [refs.roles.OWNER],
      jobFunctionIds: [refs.jobFunctions.OBGYN],
      branchIds,
      specialtyIds: [refs.specialties.GYN],
      executive_title: title,
    });
    await ensureStandardSchedule(p.id, hq.id);
  }

  await seedStaff(refs, org.id, branchIds, passwordHash, 'amshag', {
    OBGYN: 4,
    ANESTHESIOLOGIST: 4,
    PEDIATRICIAN: 4,
    ASSISTANT: 10,
    NURSE: 10,
    RECEPTIONIST: 3,
  });

  return {
    organizationId: org.id,
    branches: { HQ: hq.id, East: east.id, South: south.id },
    ownerProfileId: '',
  };
}

// ---- Generic staff seeder ---------------------------------------------------

const STAFF_LABEL: Record<JobFunctionCode, string> = {
  OBGYN: 'obgyn',
  ANESTHESIOLOGIST: 'anesth',
  PEDIATRICIAN: 'ped',
  OTHER_DOCTOR: 'doctor',
  NURSE: 'nurse',
  ASSISTANT: 'assistant',
  RECEPTIONIST: 'receptionist',
  ACCOUNTANT: 'accountant',
};

async function seedStaff(
  refs: RefData,
  organizationId: string,
  branchIds: string[],
  passwordHash: string,
  orgSlug: string,
  counts: Partial<Record<JobFunctionCode, number>>,
) {
  for (const [code, count] of Object.entries(counts) as Array<
    [JobFunctionCode, number]
  >) {
    for (let i = 1; i <= count; i++) {
      const label = STAFF_LABEL[code];
      const email = `${orgSlug}.${label}.${i}@${orgSlug}.test`;
      const user = await ensureUser(
        {
          email,
          first_name: `${label[0].toUpperCase()}${label.slice(1)}`,
          last_name: `${i}`,
        },
        passwordHash,
      );
      // Distribute staff across branches deterministically.
      const branchId = branchIds[(i - 1) % branchIds.length];
      const isClinical = code !== 'RECEPTIONIST' && code !== 'ACCOUNTANT';
      const profile = await ensureProfile({
        userId: user.id,
        organizationId,
        roleIds: [refs.roles.STAFF],
        jobFunctionIds: [refs.jobFunctions[code]],
        branchIds: [branchId],
        specialtyIds: isClinical ? [refs.specialties.GYN] : undefined,
      });
      await ensureStandardSchedule(profile.id, branchId);
    }
  }
}

// ---- Cross-org links --------------------------------------------------------

async function addCrossOrgLinks(
  refs: RefData,
  passwordHash: string,
  jasminCtx: OrgContext,
  janahCtx: OrgContext,
) {
  // Find amshag
  const amshag = await prisma.organization.findFirstOrThrow({
    where: { name: 'amshag', is_deleted: false },
    include: { branches: { where: { is_deleted: false } } },
  });

  // Mervat — janah owner already exists. Add amshag STAFF profile.
  const mervat = await prisma.user.findUniqueOrThrow({
    where: { email: 'dr.mervat.fathallah@janah.test' },
  });
  await ensureProfile({
    userId: mervat.id,
    organizationId: amshag.id,
    roleIds: [refs.roles.STAFF, refs.roles.EXTERNAL],
    jobFunctionIds: [refs.jobFunctions.OBGYN],
    branchIds: amshag.branches.map((b) => b.id),
    specialtyIds: [refs.specialties.GYN],
    engagement_type: 'PART_TIME',
  });

  // Dr. Mohamed Elsayed — on-demand pediatrician at jasmin AND janah
  const elsayed = await ensureUser(
    {
      email: 'dr.mohamed.elsayed@cradlen.test',
      first_name: 'Mohamed',
      last_name: 'Elsayed',
    },
    passwordHash,
  );

  for (const ctx of [jasminCtx, janahCtx]) {
    await ensureProfile({
      userId: elsayed.id,
      organizationId: ctx.organizationId,
      roleIds: [refs.roles.EXTERNAL],
      jobFunctionIds: [refs.jobFunctions.PEDIATRICIAN],
      branchIds: Object.values(ctx.branches),
      specialtyIds: [refs.specialties.GYN],
      engagement_type: 'ON_DEMAND',
    });
    // ON_DEMAND profiles intentionally have no fixed working schedule.
  }
}

// ---- Sample C-section -------------------------------------------------------

async function createSampleCSection(refs: RefData, jasminCtx: OrgContext) {
  // Skip if already created (deterministic title used as the dedup key).
  const title = '[Fixture] Cesarean Section — Sample';
  const existing = await prisma.calendarEvent.findFirst({
    where: {
      organization_id: jasminCtx.organizationId,
      title,
      is_deleted: false,
    },
  });
  if (existing) return;

  // Need: one patient + a primary OBGYN + an anesthesiologist + Dr. Elsayed (on-demand ped)
  const patient = await ensurePatient();
  await ensurePatientJourney(patient.id, jasminCtx);

  const sohagBranchId = jasminCtx.branches.Sohag;
  const obgynProfile = await prisma.profile.findFirstOrThrow({
    where: {
      organization_id: jasminCtx.organizationId,
      user: { email: 'dr.ahmed.hassan@jasmin.test' },
    },
  });
  const anesthProfile = await prisma.profile.findFirstOrThrow({
    where: {
      organization_id: jasminCtx.organizationId,
      job_functions: {
        some: { job_function_id: refs.jobFunctions.ANESTHESIOLOGIST },
      },
    },
  });
  const elsayedProfile = await prisma.profile.findFirstOrThrow({
    where: {
      organization_id: jasminCtx.organizationId,
      user: { email: 'dr.mohamed.elsayed@cradlen.test' },
    },
  });

  // Schedule for next Monday at 10:00 (deterministic relative to today).
  const now = new Date();
  const startsAt = new Date(now);
  const daysUntilMonday = (8 - startsAt.getDay()) % 7 || 7;
  startsAt.setDate(startsAt.getDate() + daysUntilMonday);
  startsAt.setHours(10, 0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);

  await prisma.calendarEvent.create({
    data: {
      organization_id: jasminCtx.organizationId,
      branch_id: sohagBranchId,
      created_by_id: obgynProfile.id,
      patient_id: patient.id,
      procedure_id: refs.procedures.CESAREAN_SECTION,
      type: 'SURGERY',
      title,
      description:
        'Fixture event — verifies on-demand pediatrician (Dr. Elsayed) appears among candidate staff.',
      starts_at: startsAt,
      ends_at: endsAt,
      details: {} as Prisma.InputJsonValue,
      participants: {
        create: [
          { profile_id: obgynProfile.id, role: 'PRIMARY_DOCTOR' },
          { profile_id: anesthProfile.id, role: 'ASSISTANT' },
          { profile_id: elsayedProfile.id, role: 'ASSISTANT' },
        ],
      },
    },
  });
}

async function ensurePatient() {
  const nationalId = '29901011234567';
  const existing = await prisma.patient.findUnique({
    where: { national_id: nationalId },
  });
  if (existing) return existing;
  return prisma.patient.create({
    data: {
      national_id: nationalId,
      full_name: 'Fixture Patient',
      date_of_birth: new Date('1995-06-15'),
      phone_number: '+201000000000',
      address: 'Sohag, Egypt',
    },
  });
}

async function ensurePatientJourney(patientId: string, jasminCtx: OrgContext) {
  const existing = await prisma.patientJourney.findFirst({
    where: {
      patient_id: patientId,
      organization_id: jasminCtx.organizationId,
      is_deleted: false,
    },
  });
  if (existing) return existing;
  const surgicalTemplate = await prisma.journeyTemplate.findUniqueOrThrow({
    where: { name: 'Surgical Journey' },
  });
  const ownerProfile = await prisma.profile.findFirstOrThrow({
    where: {
      organization_id: jasminCtx.organizationId,
      user: { email: 'dr.ahmed.hassan@jasmin.test' },
    },
  });
  return prisma.patientJourney.create({
    data: {
      patient_id: patientId,
      organization_id: jasminCtx.organizationId,
      journey_template_id: surgicalTemplate.id,
      created_by_id: ownerProfile.id,
    },
  });
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
