import type { PrismaClient } from '@prisma/client';

// Ordered by FK dependency — children before parents.
// Lookup tables (roles, subscription_plans) are NOT truncated; seed data must survive.
const TABLES = [
  'verification_codes',
  'refresh_tokens',
  'profile_roles',
  'profile_branches',
  'invitation_roles',
  'invitation_branches',
  'invitations',
  'join_code_roles',
  'join_code_branches',
  'join_codes',
  'subscriptions',
  'profiles',
  'branches',
  'users',
  'accounts',
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
