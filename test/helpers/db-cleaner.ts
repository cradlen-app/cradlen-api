import type { PrismaClient } from '@prisma/client';

// Ordered by FK dependency — children before parents.
// Lookup / seed tables (roles, job_functions, subscription_plans,
// specialties, procedures, journey_templates, episode_templates,
// care_paths, care_path_episodes, medications, lab_tests, form_*)
// are NOT truncated; seed data must survive between tests.
const TABLES = [
  'auth_audit_log',
  'password_reset_tokens',
  'verification_codes',
  'refresh_tokens',
  'profile_roles',
  'profile_branches',
  'profile_job_functions',
  'profile_specialties',
  'organization_specialties',
  'invitation_roles',
  'invitation_branches',
  'invitation_job_functions',
  'invitation_specialties',
  'invitations',
  'working_shifts',
  'working_days',
  'working_schedules',
  'subscriptions',
  'profiles',
  'branches',
  'users',
  'organizations',
];

export async function cleanDatabase(prisma: PrismaClient): Promise<void> {
  await (
    prisma as unknown as { $transaction: (ops: unknown[]) => Promise<unknown> }
  ).$transaction(
    TABLES.map((table) =>
      (
        prisma as unknown as {
          $executeRawUnsafe: (sql: string) => Promise<unknown>;
        }
      ).$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`),
    ),
  );
}
