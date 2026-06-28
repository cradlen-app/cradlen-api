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
  const client = prisma as unknown as {
    $executeRawUnsafe: (sql: string) => unknown;
    $transaction: (ops: unknown[]) => Promise<unknown>;
  };

  // TRUNCATE takes an ACCESS EXCLUSIVE lock on every listed table. The app
  // under test runs background async work — scheduled cleanup crons and
  // fire-and-forget domain event-listener writes (e.g. the admin-notification
  // listener reads `organizations` after an org is created) — that can hold a
  // conflicting lock past the request boundary, surfacing as a transient
  // `40P01 deadlock detected` (or `55P03 lock not available`).
  //
  // Bound the wait with a short `SET LOCAL lock_timeout` run in the SAME
  // transaction as the TRUNCATE: a contended attempt then fails FAST with
  // `55P03` (capped at lock_timeout) instead of stalling for seconds into a
  // `40P01` deadlock. A bounded retry with growing backoff lets the lingering
  // write drain and clears it deterministically without masking a real failure.
  // The short lock_timeout also keeps the transaction well under Prisma's
  // interactive-transaction timeout even against Neon latency.
  const RETRYABLE = new Set(['40P01', '55P03']);
  const MAX_ATTEMPTS = 12;
  const LOCK_TIMEOUT_MS = 3000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await client.$transaction([
        client.$executeRawUnsafe(
          `SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`,
        ),
        client.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} CASCADE`),
      ]);
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (!RETRYABLE.has(code ?? '')) throw error;
      lastError = error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1500, 200 * attempt)),
      );
    }
  }
  throw lastError;
}
