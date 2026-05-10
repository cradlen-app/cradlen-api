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
  // Roles — authority tiers only. Job-level distinctions live on JobFunction below.
  const roles = ['OWNER', 'BRANCH_MANAGER', 'STAFF', 'EXTERNAL'];
  for (const name of roles) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // Job functions — what a profile actually does. Drives staff filtering and
  // function-aware authorization checks (e.g., financial endpoints require ACCOUNTANT).
  const jobFunctions = [
    { code: 'OBGYN', name: 'OB/GYN', is_clinical: true },
    { code: 'ANESTHESIOLOGIST', name: 'Anesthesiologist', is_clinical: true },
    { code: 'PEDIATRICIAN', name: 'Pediatrician', is_clinical: true },
    { code: 'OTHER_DOCTOR', name: 'Other Doctor', is_clinical: true },
    { code: 'NURSE', name: 'Nurse', is_clinical: true },
    { code: 'ASSISTANT', name: 'Assistant', is_clinical: true },
    { code: 'RECEPTIONIST', name: 'Receptionist', is_clinical: false },
    { code: 'ACCOUNTANT', name: 'Accountant', is_clinical: false },
  ];
  for (const jf of jobFunctions) {
    await prisma.jobFunction.upsert({
      where: { code: jf.code },
      update: { name: jf.name, is_clinical: jf.is_clinical },
      create: jf,
    });
  }

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
  await prisma.subscriptionPlan.upsert({
    where: { plan: 'enterprise' },
    update: { max_organizations: 10, max_branches: 10, max_staff: 100 },
    create: { plan: 'enterprise', max_organizations: 10, max_branches: 10, max_staff: 100 },
  });

  // Specialty: GYN
  const gynSpecialty = await prisma.specialty.upsert({
    where: { code: 'GYN' },
    update: {},
    create: { name: 'Gynecology', code: 'GYN', description: 'Obstetrics and Gynecology' },
  });

  // Procedures — structured catalog used by CalendarEvent.procedure_id when type=SURGERY.
  const procedures = [
    { code: 'CESAREAN_SECTION', name: 'Cesarean Section' },
    { code: 'NORMAL_DELIVERY', name: 'Normal Delivery' },
    { code: 'D_AND_C', name: 'Dilation & Curettage' },
    { code: 'HYSTERECTOMY', name: 'Hysterectomy' },
    { code: 'LAPAROSCOPY', name: 'Laparoscopy' },
  ];
  for (const proc of procedures) {
    await prisma.procedure.upsert({
      where: { code: proc.code },
      update: { name: proc.name, specialty_id: gynSpecialty.id },
      create: { code: proc.code, name: proc.name, specialty_id: gynSpecialty.id },
    });
  }

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
