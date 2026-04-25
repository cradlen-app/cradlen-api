import type { PrismaClient } from '@prisma/client';

// Ordered by FK dependency — children before parents.
// Lookup tables (roles, subscription_plans) are NOT truncated; seed data must survive.
const TABLES = [
  'email_verifications',
  'refresh_tokens',
  'staff',
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
