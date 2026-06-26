/**
 * One-time backfill of `daily_metric_snapshots` TOTALS for days before the
 * nightly job started running, so the admin daily-trend chart isn't empty on
 * launch.
 *
 * Totals are reconstructed from each table's `created_at` (cumulative as-of the
 * UTC day's end). Actives are set to 0 — they cannot be reconstructed because
 * there was no `last_active_at` heartbeat historically; they accrue from go-live
 * forward via DailyMetricsSnapshotJob.
 *
 * Safe to run anywhere, including production: it only INSERTS days that have no
 * snapshot yet (skipDuplicates), so it never clobbers actives the cron already
 * wrote. Re-running affects zero rows.
 *
 * Usage:
 *   npm run backfill:daily-metrics
 */
import { config } from 'dotenv';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient, PatientOrgEnrollmentStatus } from '@prisma/client';

config({ path: '.env' });
config({
  path: `.env.${process.env.NODE_ENV ?? 'development'}`,
  override: true,
});

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayStartUtc(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function dateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Count of timestamps strictly before `end`, given `sorted` ascending. */
function countBefore(sorted: number[], end: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < end) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

async function main() {
  console.log('Backfilling daily_metric_snapshots totals from created_at…');

  const earliest = await prisma.user.findFirst({
    where: { is_deleted: false },
    orderBy: { created_at: 'asc' },
    select: { created_at: true },
  });
  if (!earliest) {
    console.log('No users found. Nothing to backfill.');
    return;
  }

  const now = new Date();
  const firstDay = dayStartUtc(earliest.created_at);
  const lastDay = dayStartUtc(now) - MS_PER_DAY; // yesterday (last elapsed day)
  if (lastDay < firstDay) {
    console.log('No fully-elapsed days to backfill yet.');
    return;
  }

  const [staff, portals, enrollments] = await Promise.all([
    prisma.user.findMany({
      where: { is_deleted: false },
      select: { created_at: true },
    }),
    prisma.patientAccount.findMany({
      where: { is_deleted: false, patient_id: { not: null } },
      select: { created_at: true },
    }),
    prisma.patientOrgEnrollment.findMany({
      where: {
        is_deleted: false,
        status: PatientOrgEnrollmentStatus.ACTIVE,
      },
      select: { created_at: true },
    }),
  ]);

  const staffMs = staff.map((r) => r.created_at.getTime()).sort((a, b) => a - b);
  const portalMs = portals
    .map((r) => r.created_at.getTime())
    .sort((a, b) => a - b);
  const enrollMs = enrollments
    .map((r) => r.created_at.getTime())
    .sort((a, b) => a - b);

  const rows: {
    date: Date;
    active_staff: number;
    total_staff: number;
    active_portals: number;
    total_portals: number;
    total_enrolled_patients: number;
  }[] = [];

  for (let day = firstDay; day <= lastDay; day += MS_PER_DAY) {
    const end = day + MS_PER_DAY;
    rows.push({
      date: new Date(day),
      active_staff: 0,
      total_staff: countBefore(staffMs, end),
      active_portals: 0,
      total_portals: countBefore(portalMs, end),
      total_enrolled_patients: countBefore(enrollMs, end),
    });
  }

  console.log(
    `Computed ${rows.length} day(s): ${dateKey(firstDay)} → ${dateKey(lastDay)}.`,
  );

  const result = await prisma.dailyMetricSnapshot.createMany({
    data: rows,
    skipDuplicates: true,
  });

  console.log(
    `Inserted ${result.count} new snapshot(s) (existing days left untouched).`,
  );
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
