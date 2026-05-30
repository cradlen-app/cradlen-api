import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Integration / E2E global setup.
 *
 * Requires `test/.env.test` (gitignored) with a DATABASE_URL pointing
 * at a dedicated test Postgres — DO NOT point this at any database
 * that holds real data, the cleaner truncates tables between tests.
 *
 * Applies the latest migrations, then runs the canonical seed so the
 * test database matches what production would have: roles
 * (OWNER, BRANCH_MANAGER, STAFF, EXTERNAL), job functions, subscription
 * plans, the OBGYN specialty, procedures, journey templates, etc.
 */
export default async function globalSetup() {
  const envFile = path.resolve(__dirname, '../.env.test');
  if (fs.existsSync(envFile)) {
    const { config } = await import('dotenv');
    config({ path: envFile });
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL must be set for E2E/integration tests. Create test/.env.test or set the env var.',
    );
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env },
    stdio: 'inherit',
  });

  // Canonical seed — gives us OWNER/BRANCH_MANAGER/STAFF/EXTERNAL roles,
  // job functions, subscription plans, OBGYN specialty, journey templates,
  // care paths, medications, lab tests, and the OB/GYN form templates.
  execSync('npx prisma db seed', {
    env: { ...process.env },
    stdio: 'inherit',
  });
}
