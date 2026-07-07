/**
 * One-time backfill: re-route every visit of an ACTIVE pregnancy / surgical
 * journey onto the episode that matches its computed stage, and advance the
 * journey's ACTIVE-episode pointer accordingly.
 *
 * Why: the clinical PATCH surfaces used to store the routing input (LMP / US
 * dating for pregnancy, surgery_date for surgical) WITHOUT re-routing the visit,
 * so visits whose dating was entered/corrected after activation got stuck in the
 * episode activation/booking originally placed them in (typically Episode 1).
 * New saves are fixed in code (the clinical services now re-route on the routing
 * input change); this script corrects historical rows.
 *
 * Reuses the same resolution + write logic the app uses — the routers are plain
 * @Injectable() services with no constructor deps, so they run standalone here.
 *
 * Safe to run anywhere, including production: each re-route is an idempotent,
 * per-visit transaction that only fires when the visit's current episode differs
 * from its computed one. Re-running affects zero rows.
 *
 * Usage:
 *   npm run backfill:journey-episode-routing
 */
import { config } from 'dotenv';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';
import { PregnancyEpisodeRouterService } from '../src/specialties/obgyn/pregnancy/pregnancy-episode-router.service';
import { SurgicalEpisodeRouterService } from '../src/specialties/obgyn/surgical/surgical-episode-router.service';

config({ path: '.env' });
config({
  path: `.env.${process.env.NODE_ENV ?? 'development'}`,
  override: true,
});

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const pregnancyRouter = new PregnancyEpisodeRouterService();
const surgicalRouter = new SurgicalEpisodeRouterService();

/** Load the journey's non-deleted visits with their current episode order. */
function visitsForJourney(journeyId: string) {
  return prisma.visit.findMany({
    where: { is_deleted: false, episode: { journey_id: journeyId } },
    select: {
      id: true,
      scheduled_at: true,
      created_at: true,
      episode: { select: { order: true } },
    },
  });
}

async function backfillPregnancy(): Promise<{ scanned: number; moved: number }> {
  const records = await prisma.pregnancyJourneyRecord.findMany({
    where: { status: 'ACTIVE', is_deleted: false },
  });
  let moved = 0;
  for (const record of records) {
    const visits = await visitsForJourney(record.journey_id);
    for (const visit of visits) {
      const asOf = visit.scheduled_at ?? visit.created_at;
      const order = pregnancyRouter.resolveTrimesterOrder(record, asOf);
      if (order == null || order === visit.episode.order) continue;
      await prisma.$transaction((tx) =>
        pregnancyRouter.routeVisitToTrimester(
          tx,
          record.journey_id,
          visit.id,
          order,
        ),
      );
      moved += 1;
    }
  }
  return { scanned: records.length, moved };
}

async function backfillSurgical(): Promise<{ scanned: number; moved: number }> {
  const records = await prisma.surgicalJourneyRecord.findMany({
    where: { status: 'ACTIVE', is_deleted: false },
  });
  let moved = 0;
  for (const record of records) {
    const visits = await visitsForJourney(record.journey_id);
    for (const visit of visits) {
      const asOf = visit.scheduled_at ?? visit.created_at;
      const order = surgicalRouter.resolveEpisodeOrder(record.surgery_date, asOf);
      if (order == null || order === visit.episode.order) continue;
      await prisma.$transaction((tx) =>
        surgicalRouter.routeVisitToEpisode(
          tx,
          record.journey_id,
          visit.id,
          order,
        ),
      );
      moved += 1;
    }
  }
  return { scanned: records.length, moved };
}

async function main() {
  console.log('Backfilling journey episode routing (pregnancy + surgical)…');

  const preg = await backfillPregnancy();
  console.log(
    `Pregnancy: scanned ${preg.scanned} active journey(s), re-routed ${preg.moved} visit(s).`,
  );

  const surg = await backfillSurgical();
  console.log(
    `Surgical: scanned ${surg.scanned} active journey(s), re-routed ${surg.moved} visit(s).`,
  );

  if (preg.moved === 0 && surg.moved === 0) {
    console.log('Nothing to backfill.');
  }
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
