/* eslint-disable */
// One-off idempotent migration: collapse JobFunction catalog to
// { DOCTOR(clinical), RECEPTIONIST, ACCOUNTANT }. Repoints existing clinical
// doctor job-function links to DOCTOR, drops NURSE/ASSISTANT links, then deletes
// the obsolete catalog rows. Run: TARGET_ENV=development|production node tmp-migrate-job-functions.cjs
const { PrismaNeon } = require('@prisma/adapter-neon');
const { PrismaClient } = require('@prisma/client');

const env = process.env.TARGET_ENV || 'development';
require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: `.env.${env}`, override: true });

const url = process.env.DATABASE_URL;
const host = (u) => { try { return new URL(u).hostname; } catch { return '?'; } };
console.log(`[${env}] target host: ${host(url)}`);

const adapter = new PrismaNeon({ connectionString: url });
const prisma = new PrismaClient({ adapter });

const DOCTOR_CLINICAL = ['OBGYN', 'ANESTHESIOLOGIST', 'PEDIATRICIAN', 'OTHER_DOCTOR'];
const DROP = ['NURSE', 'ASSISTANT'];
const OBSOLETE = [...DOCTOR_CLINICAL, ...DROP];

async function main() {
  const doctor = await prisma.jobFunction.upsert({
    where: { code: 'DOCTOR' },
    update: { name: 'Doctor', is_clinical: true },
    create: { code: 'DOCTOR', name: 'Doctor', is_clinical: true },
  });
  await prisma.jobFunction.upsert({
    where: { code: 'RECEPTIONIST' },
    update: { is_clinical: false },
    create: { code: 'RECEPTIONIST', name: 'Receptionist', is_clinical: false },
  });
  await prisma.jobFunction.upsert({
    where: { code: 'ACCOUNTANT' },
    update: { is_clinical: false },
    create: { code: 'ACCOUNTANT', name: 'Accountant', is_clinical: false },
  });

  const obsolete = await prisma.jobFunction.findMany({ where: { code: { in: OBSOLETE } } });
  const doctorIds = obsolete.filter((j) => DOCTOR_CLINICAL.includes(j.code)).map((j) => j.id);
  const dropIds = obsolete.filter((j) => DROP.includes(j.code)).map((j) => j.id);

  for (const [model, fk] of [['profileJobFunction', 'profile_id'], ['invitationJobFunction', 'invitation_id']]) {
    let repointed = 0, deduped = 0;
    if (doctorIds.length) {
      const links = await prisma[model].findMany({ where: { job_function_id: { in: doctorIds } } });
      for (const link of links) {
        const dup = await prisma[model].findFirst({
          where: { [fk]: link[fk], job_function_id: doctor.id },
        });
        if (dup) { await prisma[model].delete({ where: { id: link.id } }); deduped++; }
        else { await prisma[model].update({ where: { id: link.id }, data: { job_function_id: doctor.id } }); repointed++; }
      }
    }
    let dropped = { count: 0 };
    if (dropIds.length) dropped = await prisma[model].deleteMany({ where: { job_function_id: { in: dropIds } } });
    console.log(`[${env}] ${model}: repointed=${repointed} deduped=${deduped} droppedNurseAssistant=${dropped.count}`);
  }

  const del = await prisma.jobFunction.deleteMany({ where: { code: { in: OBSOLETE } } });
  const remaining = await prisma.jobFunction.findMany({ orderBy: { code: 'asc' } });
  console.log(`[${env}] deleted ${del.count} obsolete catalog rows`);
  console.log(`[${env}] catalog now: ${remaining.map((r) => `${r.code}(clinical=${r.is_clinical})`).join(', ')}`);

  // ---- Roles: collapse to OWNER / BRANCH_MANAGER / STAFF; drop EXTERNAL -------
  for (const code of ['OWNER', 'BRANCH_MANAGER', 'STAFF']) {
    await prisma.role.upsert({ where: { code }, update: { name: code }, create: { code, name: code } });
  }
  const staff = await prisma.role.findUnique({ where: { code: 'STAFF' } });
  const external = await prisma.role.findUnique({ where: { code: 'EXTERNAL' } });
  if (external && staff) {
    for (const [model, fk] of [['profileRole', 'profile_id'], ['invitationRole', 'invitation_id']]) {
      let repointed = 0, deduped = 0;
      const links = await prisma[model].findMany({ where: { role_id: external.id } });
      for (const link of links) {
        const dup = await prisma[model].findFirst({ where: { [fk]: link[fk], role_id: staff.id } });
        if (dup) { await prisma[model].delete({ where: { id: link.id } }); deduped++; }
        else { await prisma[model].update({ where: { id: link.id }, data: { role_id: staff.id } }); repointed++; }
      }
      console.log(`[${env}] ${model}: EXTERNAL->STAFF repointed=${repointed} deduped=${deduped}`);
    }
    await prisma.role.delete({ where: { id: external.id } });
    console.log(`[${env}] deleted EXTERNAL role row`);
  } else {
    console.log(`[${env}] EXTERNAL role already absent`);
  }
  const roles = await prisma.role.findMany({ orderBy: { code: 'asc' } });
  console.log(`[${env}] roles now: ${roles.map((r) => r.code).join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
