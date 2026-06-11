/**
 * One-time backfill: set `invoices.assigned_doctor_id` from the linked visit's
 * required `assigned_doctor_id` for invoices that were created without a doctor.
 *
 * Why: the manual invoice-create path used to store a null doctor when the
 * caller didn't pass one, so those invoices bucket as "Unassigned" in the
 * By Doctor report. New invoices are fixed in code (InvoicingService.create
 * backfills from the visit); this script corrects historical rows.
 *
 * Safe to run anywhere, including production: it is a single idempotent UPDATE
 * scoped to non-deleted invoices that have a visit but no doctor. Re-running
 * affects zero rows.
 *
 * Usage:
 *   npm run backfill:invoice-doctor
 */
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
  console.log('Backfilling invoices.assigned_doctor_id from their visit…');

  const candidates = await prisma.invoice.count({
    where: {
      is_deleted: false,
      assigned_doctor_id: null,
      visit_id: { not: null },
    },
  });
  console.log(`Found ${candidates} invoice(s) with a visit but no doctor.`);

  if (candidates === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  const updated = await prisma.$executeRaw`
    UPDATE "invoices" AS i
    SET "assigned_doctor_id" = v."assigned_doctor_id",
        "updated_at" = NOW()
    FROM "visits" AS v
    WHERE i."visit_id" = v."id"
      AND i."assigned_doctor_id" IS NULL
      AND i."is_deleted" = false
  `;

  console.log(`Updated ${updated} invoice(s).`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
