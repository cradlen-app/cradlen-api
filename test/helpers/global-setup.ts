import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export default async function globalSetup() {
  const envFile = path.resolve(__dirname, '../.env.test');
  if (fs.existsSync(envFile)) {
    const { config } = await import('dotenv');
    config({ path: envFile });
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set for E2E/integration tests. Create test/.env.test or set env var.');
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env },
    stdio: 'inherit',
  });

  const { PrismaNeon } = await import('@prisma/adapter-neon');
  const { PrismaClient } = await import('@prisma/client');
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

  await prisma.role.upsert({
    where: { name: 'owner' },
    update: {},
    create: { name: 'owner' },
  });

  await prisma.subscriptionPlan.upsert({
    where: { plan: 'free_trial' },
    update: {},
    create: { plan: 'free_trial', max_branches: 1, max_staff: 5 },
  });

  await (prisma as { $disconnect: () => Promise<void> }).$disconnect();
}
