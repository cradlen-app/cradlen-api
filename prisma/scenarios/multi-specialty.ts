/**
 * Multi-specialty scenario for the shared `book_visit` flow.
 *
 * Builds (idempotently) one org with TWO specialties — `OBGYN` (aligned with
 * the seeded extension_key so the OB/GYN extension composes) and `PED` (no
 * extension; shell-only validation) — plus two doctors who carry both
 * specialty links and two nurses who carry none.
 *
 * Then manually wires `VisitsService` against the dev DB and runs five real
 * `bookVisit()` cases:
 *
 *   1. OBGYN booking with a dual-specialty doctor                → 201
 *   2. PED booking with a dual-specialty doctor                  → 201 (shell-only)
 *   3. Nurse assigned as doctor                                  → 400 (assertDoctorSpecialty)
 *   4. specialty_code mismatched against an OBGYN-only doctor    → 400
 *   5. PATIENT booking with a leaked MEDICAL_REP field           → 400 (template FORBIDDEN)
 *
 * Skips the Nest DI container entirely — the `.js` suffix import style this
 * repo uses doesn't survive a plain ts-node/tsx bootstrap of AppModule. The
 * dependency graph for VisitsService is small (Prisma, EventBus, validator,
 * templates), so we hand-wire it.
 *
 * Usage:
 *   npx tsx prisma/scenarios/multi-specialty.ts
 *
 * Refuses to run when NODE_ENV=production.
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { PrismaNeon } from '@prisma/adapter-neon';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  PrismaClient,
  type Organization,
  type Specialty,
  type Branch,
  type Profile,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { VisitsService } from '../../src/core/clinical/visits/visits.service';
import { TemplateValidator } from '../../src/builder/validator/template.validator';
import { TemplatesService } from '../../src/builder/templates/templates.service';
import { TemplateRendererService } from '../../src/builder/renderer/template-renderer.service';
import { TemplateCompositionService } from '../../src/builder/templates/template-composition.service';
import { EventBus } from '../../src/infrastructure/messaging/event-bus';
import type { AuthContext } from '../../src/common/interfaces/auth-context.interface';
import type { BookVisitDto } from '../../src/core/clinical/visits/dto/book-visit.dto';
import type { PrismaService } from '../../src/infrastructure/database/prisma.service';

config({ path: '.env' });
config({
  path: `.env.${process.env.NODE_ENV ?? 'development'}`,
  override: true,
});

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const PASSWORD = 'TestPass123!';
const ORG_NAME = 'multispec-scenario';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('multi-specialty scenario must not run in production');
  }

  console.log('=== Setup: org / specialties / staff ===');
  const ctx = await setup();

  console.log('=== Wire VisitsService (manual, bypassing Nest DI) ===');
  const visits = wireVisitsService();

  const auth: AuthContext = {
    userId: ctx.ownerUserId,
    profileId: ctx.ownerProfileId,
    organizationId: ctx.org.id,
    activeBranchId: ctx.branch.id,
    roles: ['OWNER'],
    branchIds: [ctx.branch.id],
  };

  await runCase('1. OBGYN booking with dual-specialty doctor', () =>
    visits.bookVisit(baseDto(ctx, ctx.drDual1.id, 'OBGYN'), auth),
  );

  await runCase('2. PED booking with dual-specialty doctor (shell-only)', () =>
    visits.bookVisit(baseDto(ctx, ctx.drDual2.id, 'PED'), auth),
  );

  await runCase(
    '3. Nurse assigned as doctor (should 400: doctor lacks specialty)',
    () => visits.bookVisit(baseDto(ctx, ctx.nurse1.id, 'OBGYN'), auth),
    { expectFail: true },
  );

  await runCase(
    '4. PED booking with OBGYN-only narrow doctor (should 400)',
    () => visits.bookVisit(baseDto(ctx, ctx.drNarrowObgyn.id, 'PED'), auth),
    { expectFail: true },
  );

  await runCase(
    '5. Leaked MEDICAL_REP field in PATIENT booking (should 400: FORBIDDEN)',
    () => {
      const dto = baseDto(ctx, ctx.drDual1.id, 'OBGYN');
      // Force a cross-discriminator leak — rep_full_name is a MEDICAL_REP
      // namespace path and the template auto-forbids it when
      // visitor_type=PATIENT.
      (dto as unknown as Record<string, unknown>).rep_full_name = 'Leaked Rep';
      return visits.bookVisit(dto, auth);
    },
    { expectFail: true },
  );

  await prisma.$disconnect();
  console.log('\n=== Done ===');
}

// ---- Wiring -----------------------------------------------------------------

function wireVisitsService(): VisitsService {
  const prismaService = { db: prisma } as unknown as PrismaService;
  const renderer = new TemplateRendererService();
  const composition = new TemplateCompositionService();
  const templates = new TemplatesService(prismaService, composition);
  const validator = new TemplateValidator(templates, renderer);
  const eventBus = new EventBus(new EventEmitter2());
  return new VisitsService(prismaService, eventBus, validator, templates);
}

// ---- Setup ------------------------------------------------------------------

interface SetupCtx {
  org: Organization;
  branch: Branch;
  obgyn: Specialty;
  ped: Specialty;
  ownerUserId: string;
  ownerProfileId: string;
  drDual1: Profile;
  drDual2: Profile;
  drNarrowObgyn: Profile;
  nurse1: Profile;
  nurse2: Profile;
}

async function setup(): Promise<SetupCtx> {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  // Two specialties — OBGYN aligned with the extension_key so the obgyn
  // extension actually composes; PED stays extension-less.
  const obgyn = await prisma.specialty.upsert({
    where: { code: 'OBGYN' },
    update: {},
    create: { code: 'OBGYN', name: 'Obstetrics & Gynecology' },
  });
  const ped = await prisma.specialty.upsert({
    where: { code: 'PED' },
    update: {},
    create: { code: 'PED', name: 'Pediatrics' },
  });

  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: { name: 'OWNER' },
  });
  const staffRole = await prisma.role.findUniqueOrThrow({
    where: { name: 'STAFF' },
  });
  const jobFns = await prisma.jobFunction.findMany();
  const jobFnByCode = Object.fromEntries(jobFns.map((j) => [j.code, j.id])) as
    Record<string, string>;

  const org = await ensureOrg(ORG_NAME);
  await ensureOrgSpecialty(org.id, obgyn.id);
  await ensureOrgSpecialty(org.id, ped.id);

  const branch = await ensureBranch(org.id, 'Main', true);

  const ownerUser = await ensureUser(
    'owner@multispec.test',
    'Mona',
    'Owner',
    passwordHash,
  );
  const ownerProfile = await ensureProfile(ownerUser.id, org.id, [
    ownerRole.id,
  ]);
  await ensureBranchLink(ownerProfile.id, branch.id, org.id);

  const drDual1 = await ensureStaff(
    'dr.dual1@multispec.test',
    'Sara',
    'Dual',
    passwordHash,
    org.id,
    branch.id,
    [staffRole.id],
    [jobFnByCode.OBGYN, jobFnByCode.PEDIATRICIAN],
    [obgyn.id, ped.id],
  );
  const drDual2 = await ensureStaff(
    'dr.dual2@multispec.test',
    'Omar',
    'Dual',
    passwordHash,
    org.id,
    branch.id,
    [staffRole.id],
    [jobFnByCode.OBGYN, jobFnByCode.PEDIATRICIAN],
    [obgyn.id, ped.id],
  );
  const drNarrowObgyn = await ensureStaff(
    'dr.narrow.obgyn@multispec.test',
    'Lina',
    'Obgyn',
    passwordHash,
    org.id,
    branch.id,
    [staffRole.id],
    [jobFnByCode.OBGYN],
    [obgyn.id],
  );
  const nurse1 = await ensureStaff(
    'nurse1@multispec.test',
    'Nadia',
    'Nurse',
    passwordHash,
    org.id,
    branch.id,
    [staffRole.id],
    [jobFnByCode.NURSE],
    [],
  );
  const nurse2 = await ensureStaff(
    'nurse2@multispec.test',
    'Hala',
    'Nurse',
    passwordHash,
    org.id,
    branch.id,
    [staffRole.id],
    [jobFnByCode.NURSE],
    [],
  );

  console.log(
    `  org=${org.id.slice(0, 8)}…  branch=${branch.id.slice(0, 8)}…\n` +
      `  drDual1=${drDual1.id.slice(0, 8)}  drDual2=${drDual2.id.slice(0, 8)}\n` +
      `  drNarrowObgyn=${drNarrowObgyn.id.slice(0, 8)}\n` +
      `  nurse1=${nurse1.id.slice(0, 8)}  nurse2=${nurse2.id.slice(0, 8)}`,
  );

  return {
    org,
    branch,
    obgyn,
    ped,
    ownerUserId: ownerUser.id,
    ownerProfileId: ownerProfile.id,
    drDual1,
    drDual2,
    drNarrowObgyn,
    nurse1,
    nurse2,
  };
}

async function ensureOrg(name: string) {
  const existing = await prisma.organization.findFirst({
    where: { name, is_deleted: false },
  });
  if (existing) return existing;
  return prisma.organization.create({ data: { name } });
}

async function ensureOrgSpecialty(orgId: string, specialtyId: string) {
  await prisma.organizationSpecialty.upsert({
    where: {
      organization_id_specialty_id: {
        organization_id: orgId,
        specialty_id: specialtyId,
      },
    },
    update: {},
    create: { organization_id: orgId, specialty_id: specialtyId },
  });
}

async function ensureBranch(orgId: string, name: string, isMain: boolean) {
  const existing = await prisma.branch.findFirst({
    where: { organization_id: orgId, name, is_deleted: false },
  });
  if (existing) return existing;
  return prisma.branch.create({
    data: {
      organization_id: orgId,
      name,
      city: 'Cairo',
      governorate: 'Cairo',
      address: '1 Test St',
      country: 'Egypt',
      is_main: isMain,
    },
  });
}

async function ensureUser(
  email: string,
  first: string,
  last: string,
  passwordHash: string,
) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      email,
      first_name: first,
      last_name: last,
      password_hashed: passwordHash,
      verified_at: new Date(),
      registration_status: 'ACTIVE',
      onboarding_completed: true,
      is_active: true,
    },
  });
}

async function ensureProfile(userId: string, orgId: string, roleIds: string[]) {
  const profile = await prisma.profile.upsert({
    where: { user_id_organization_id: { user_id: userId, organization_id: orgId } },
    update: { is_active: true, is_deleted: false },
    create: { user_id: userId, organization_id: orgId },
  });
  for (const role_id of roleIds) {
    await prisma.profileRole.upsert({
      where: { profile_id_role_id: { profile_id: profile.id, role_id } },
      update: {},
      create: { profile_id: profile.id, role_id },
    });
  }
  return profile;
}

async function ensureBranchLink(
  profileId: string,
  branchId: string,
  orgId: string,
) {
  await prisma.profileBranch.upsert({
    where: { profile_id_branch_id: { profile_id: profileId, branch_id: branchId } },
    update: {},
    create: {
      profile_id: profileId,
      branch_id: branchId,
      organization_id: orgId,
    },
  });
}

async function ensureStaff(
  email: string,
  first: string,
  last: string,
  passwordHash: string,
  orgId: string,
  branchId: string,
  roleIds: string[],
  jobFunctionIds: string[],
  specialtyIds: string[],
): Promise<Profile> {
  const user = await ensureUser(email, first, last, passwordHash);
  const profile = await ensureProfile(user.id, orgId, roleIds);
  await ensureBranchLink(profile.id, branchId, orgId);
  for (const job_function_id of jobFunctionIds) {
    await prisma.profileJobFunction.upsert({
      where: {
        profile_id_job_function_id: {
          profile_id: profile.id,
          job_function_id,
        },
      },
      update: {},
      create: { profile_id: profile.id, job_function_id },
    });
  }
  for (const specialty_id of specialtyIds) {
    await prisma.profileSpecialty.upsert({
      where: {
        profile_id_specialty_id: { profile_id: profile.id, specialty_id },
      },
      update: {},
      create: { profile_id: profile.id, specialty_id },
    });
  }
  return profile;
}

// ---- Cases ------------------------------------------------------------------

function baseDto(ctx: SetupCtx, doctorId: string, specialty: string): BookVisitDto {
  return {
    visitor_type: 'PATIENT',
    specialty_code: specialty,
    national_id: `nid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    full_name: 'Test Patient',
    date_of_birth: '1990-01-01',
    phone_number: '0500000000',
    address: '1 Patient St',
    assigned_doctor_id: doctorId,
    appointment_type: 'VISIT',
    priority: 'NORMAL',
    scheduled_at: new Date().toISOString(),
    branch_id: ctx.branch.id,
  } as BookVisitDto;
}

async function runCase(
  label: string,
  run: () => Promise<unknown>,
  opts: { expectFail?: boolean } = {},
) {
  console.log(`\n--- ${label} ---`);
  try {
    const out = (await run()) as { visit?: { id: string } } | undefined;
    if (opts.expectFail) {
      console.log(
        `  ✗ UNEXPECTED PASS — booking succeeded but should have failed`,
      );
      console.log(`    visit.id=${out?.visit?.id}`);
      return;
    }
    console.log(`  ✓ PASS — visit.id=${out?.visit?.id}`);
  } catch (err) {
    const e = err as { message?: string; response?: unknown; name?: string };
    const detail = e.response
      ? JSON.stringify(e.response)
      : (e.message ?? String(err));
    if (opts.expectFail) {
      console.log(`  ✓ PASS (rejected) — ${e.name ?? 'Error'}: ${detail}`);
    } else {
      console.log(`  ✗ UNEXPECTED FAIL — ${e.name ?? 'Error'}: ${detail}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
