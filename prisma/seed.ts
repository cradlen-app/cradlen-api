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
    update: { max_organizations: 1, max_branches: 1, max_staff: 5 },
    create: { plan: 'free_trial', max_organizations: 1, max_branches: 1, max_staff: 5 },
  });
  await prisma.subscriptionPlan.upsert({
    where: { plan: 'plus' },
    update: { max_organizations: 3, max_branches: 3, max_staff: 15 },
    create: { plan: 'plus', max_organizations: 3, max_branches: 3, max_staff: 15 },
  });
  await prisma.subscriptionPlan.upsert({
    where: { plan: 'pro' },
    update: { max_organizations: 5, max_branches: 5, max_staff: 25 },
    create: { plan: 'pro', max_organizations: 5, max_branches: 5, max_staff: 25 },
  });

  // Specialty: GYN
  const gynSpecialty = await prisma.specialty.upsert({
    where: { code: 'GYN' },
    update: {},
    create: { name: 'Gynecology', code: 'GYN', description: 'Obstetrics and Gynecology' },
  });

  // Journey Templates
  const pregnancyTemplate = await prisma.journeyTemplate.upsert({
    where: { name: 'Pregnancy Journey' },
    update: {},
    create: {
      specialty_id: gynSpecialty.id,
      name: 'Pregnancy Journey',
      type: 'PREGNANCY',
      description: 'Full antenatal and postnatal pregnancy pathway',
    },
  });

  const generalGynTemplate = await prisma.journeyTemplate.upsert({
    where: { name: 'General GYN Journey' },
    update: {},
    create: {
      specialty_id: gynSpecialty.id,
      name: 'General GYN Journey',
      type: 'GENERAL_GYN',
      description: 'General gynecology consultations and follow-ups',
    },
  });

  const surgicalTemplate = await prisma.journeyTemplate.upsert({
    where: { name: 'Surgical Journey' },
    update: {},
    create: {
      specialty_id: gynSpecialty.id,
      name: 'Surgical Journey',
      type: 'SURGICAL',
      description: 'Pre-operative, surgical, and post-operative care',
    },
  });

  const chronicTemplate = await prisma.journeyTemplate.upsert({
    where: { name: 'Chronic Condition Journey' },
    update: {},
    create: {
      specialty_id: gynSpecialty.id,
      name: 'Chronic Condition Journey',
      type: 'CHRONIC_CONDITION',
      description: 'Long-term management of chronic gynecological conditions',
    },
  });

  // Episode Templates — upsert by template + order pair
  const pregnancyEpisodes = [
    { name: 'First Trimester', order: 1 },
    { name: 'Second Trimester', order: 2 },
    { name: 'Third Trimester', order: 3 },
    { name: 'Delivery', order: 4 },
    { name: 'Postpartum', order: 5 },
  ];
  for (const ep of pregnancyEpisodes) {
    const existing = await prisma.episodeTemplate.findFirst({
      where: { journey_template_id: pregnancyTemplate.id, order: ep.order },
    });
    if (!existing) {
      await prisma.episodeTemplate.create({
        data: { journey_template_id: pregnancyTemplate.id, ...ep },
      });
    }
  }

  const generalGynEpisodes = [{ name: 'General Consultation', order: 1 }];
  for (const ep of generalGynEpisodes) {
    const existing = await prisma.episodeTemplate.findFirst({
      where: { journey_template_id: generalGynTemplate.id, order: ep.order },
    });
    if (!existing) {
      await prisma.episodeTemplate.create({
        data: { journey_template_id: generalGynTemplate.id, ...ep },
      });
    }
  }

  const surgicalEpisodes = [
    { name: 'Pre-operative', order: 1 },
    { name: 'Surgery', order: 2 },
    { name: 'Post-operative', order: 3 },
  ];
  for (const ep of surgicalEpisodes) {
    const existing = await prisma.episodeTemplate.findFirst({
      where: { journey_template_id: surgicalTemplate.id, order: ep.order },
    });
    if (!existing) {
      await prisma.episodeTemplate.create({
        data: { journey_template_id: surgicalTemplate.id, ...ep },
      });
    }
  }

  const chronicEpisodes = [
    { name: 'Diagnosis & Stabilization', order: 1 },
    { name: 'Ongoing Management', order: 2 },
  ];
  for (const ep of chronicEpisodes) {
    const existing = await prisma.episodeTemplate.findFirst({
      where: { journey_template_id: chronicTemplate.id, order: ep.order },
    });
    if (!existing) {
      await prisma.episodeTemplate.create({
        data: { journey_template_id: chronicTemplate.id, ...ep },
      });
    }
  }

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
