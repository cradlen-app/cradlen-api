import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PatientOrgEnrollmentStatus } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Writes one `daily_metric_snapshots` row per UTC day, summarizing the
 * just-finished day. Runs at 00:05 UTC so the day's window is fully closed.
 * `active_*` count entities whose `last_active_at` fell in the day; `total_*`
 * are cumulative as-of the day's end. Idempotent: upserts on `date`, so a
 * manual re-run (or a retry after a crash) overwrites rather than duplicates.
 */
@Injectable()
export class DailyMetricsSnapshotJob {
  private readonly logger = new Logger(DailyMetricsSnapshotJob.name);

  constructor(private readonly prismaService: PrismaService) {}

  @Cron('5 0 * * *')
  async handleSnapshot(): Promise<void> {
    const now = new Date();
    const todayStart = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    await this.snapshotDay(new Date(todayStart - MS_PER_DAY));
  }

  /** Compute and upsert the snapshot for the UTC day starting at `dayStart`. */
  async snapshotDay(dayStart: Date): Promise<void> {
    const start = dayStart;
    const end = new Date(dayStart.getTime() + MS_PER_DAY);
    const db = this.prismaService.db;

    try {
      const [
        active_staff,
        total_staff,
        active_portals,
        total_portals,
        total_enrolled_patients,
      ] = await Promise.all([
        db.user.count({
          where: {
            is_deleted: false,
            last_active_at: { gte: start, lt: end },
          },
        }),
        db.user.count({
          where: { is_deleted: false, created_at: { lt: end } },
        }),
        db.patientAccount.count({
          where: {
            is_deleted: false,
            patient_id: { not: null },
            last_active_at: { gte: start, lt: end },
          },
        }),
        db.patientAccount.count({
          where: {
            is_deleted: false,
            patient_id: { not: null },
            created_at: { lt: end },
          },
        }),
        db.patientOrgEnrollment.count({
          where: {
            is_deleted: false,
            status: PatientOrgEnrollmentStatus.ACTIVE,
            created_at: { lt: end },
          },
        }),
      ]);

      const data = {
        active_staff,
        total_staff,
        active_portals,
        total_portals,
        total_enrolled_patients,
      };
      await db.dailyMetricSnapshot.upsert({
        where: { date: start },
        create: { date: start, ...data },
        update: data,
      });

      this.logger.log(
        `Snapshot ${dateKey(start)}: active_staff=${active_staff}/${total_staff}, active_portals=${active_portals}/${total_portals}`,
      );
    } catch (err) {
      this.logger.error(
        `Daily metrics snapshot failed for ${dateKey(start)}`,
        err,
      );
    }
  }
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
