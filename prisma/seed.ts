import { config } from 'dotenv';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';

config({ path: '.env' });
config({ path: `.env.${process.env.NODE_ENV ?? 'development'}`, override: true });

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
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

  console.log('Seed complete: owner role and free_trial plan upserted.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
