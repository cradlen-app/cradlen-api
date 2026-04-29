import { config } from 'dotenv';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';

config({ path: '.env' });
config({
  path: `.env.${process.env.NODE_ENV ?? 'development'}`,
  override: true,
});

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.role.upsert({
    where: { name: 'OWNER' },
    update: {},
    create: { name: 'OWNER' },
  });
  await prisma.role.upsert({
    where: { name: 'DOCTOR' },
    update: {},
    create: { name: 'DOCTOR' },
  });
  await prisma.role.upsert({
    where: { name: 'RECEPTIONIST' },
    update: {},
    create: { name: 'RECEPTIONIST' },
  });

  await prisma.subscriptionPlan.upsert({
    where: { plan: 'free_trial' },
    update: {},
    create: { plan: 'free_trial', max_branches: 1, max_staff: 5 },
  });
  await prisma.subscriptionPlan.upsert({
    where: { plan: 'plus' },
    update: {},
    create: { plan: 'plus', max_branches: 3, max_staff: 15 },
  });
  await prisma.subscriptionPlan.upsert({
    where: { plan: 'pro' },
    update: {},
    create: { plan: 'pro', max_branches: 5, max_staff: 25 },
  });

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
