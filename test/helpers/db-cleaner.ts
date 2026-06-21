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
  'profile_branches',
  // role/job_function/specialty are now single FK columns on profiles/invitations
  // (no join tables); subspecialty remains a join. `subspecialties` is seed
  // catalog and is NOT truncated (like `specialties`).
  'profile_subspecialties',
  'organization_specialties',
  'invitation_branches',
  'invitation_subspecialties',
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
  // Single multi-table TRUNCATE … CASCADE — one network round-trip instead of
  // 21 sequential statements wrapped in a transaction. The transactional form
  // intermittently blew past Prisma's 5s interactive-transaction timeout
  // against Neon's latency; a single statement is atomic, faster, and
  // FK-order-independent (CASCADE handles dependents).
  const tableList = TABLES.map((table) => `"${table}"`).join(', ');
  const exec = (
    prisma as unknown as {
      $executeRawUnsafe: (sql: string) => Promise<unknown>;
    }
  ).$executeRawUnsafe.bind(prisma);

  // TRUNCATE takes an ACCESS EXCLUSIVE lock on every listed table. The app
  // under test runs background async work (scheduled cleanup crons, domain
  // event-listener writes) that can momentarily hold a conflicting lock,
  // surfacing as a transient `40P01 deadlock detected` (or `55P03 lock not
  // available`). The loser is aborted immediately, so a short bounded retry
  // clears it deterministically without masking a real failure.
  const RETRYABLE = new Set(['40P01', '55P03']);
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await exec(`TRUNCATE TABLE ${tableList} CASCADE`);
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (!RETRYABLE.has(code ?? '')) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastError;
}
