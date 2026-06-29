import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { AdminDailyMetricPointDto } from './dto/admin-daily-metrics.dto.js';

const DEFAULT_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Reads the per-day engagement trend from the `daily_metric_snapshots` table
 * (written nightly by DailyMetricsSnapshotJob). Returns a contiguous series of
 * the last N UTC days ending yesterday — the most recent fully-elapsed day —
 * seeding any day without a snapshot row as zeros so the frontend never has to
 * handle gaps. Read-only; no fallback recomputation.
 */
@Injectable()
export class AdminDailyMetricsService {
  constructor(private readonly prismaService: PrismaService) {}

  async getDailyTrends(
    days = DEFAULT_DAYS,
  ): Promise<AdminDailyMetricPointDto[]> {
    const now = new Date();
    const todayStartUtc = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );

    // The N UTC days ending yesterday, oldest first.
    const dayStarts: number[] = [];
    for (let i = days; i >= 1; i--) {
      dayStarts.push(todayStartUtc - i * MS_PER_DAY);
    }

    const rows = await this.prismaService.db.dailyMetricSnapshot.findMany({
      where: {
        date: {
          gte: new Date(dayStarts[0]),
          lte: new Date(todayStartUtc - MS_PER_DAY),
        },
      },
    });
    const byDate = new Map(rows.map((r) => [dateKey(r.date), r]));

    return dayStarts.map((ms): AdminDailyMetricPointDto => {
      const date = dateKey(new Date(ms));
      const row = byDate.get(date);
      return {
        date,
        active_staff: row?.active_staff ?? 0,
        total_staff: row?.total_staff ?? 0,
        active_portals: row?.active_portals ?? 0,
        total_portals: row?.total_portals ?? 0,
        total_enrolled_patients: row?.total_enrolled_patients ?? 0,
      };
    });
  }
}

/** `YYYY-MM-DD` in UTC — matches how @db.Date rows are stored (UTC midnight). */
function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
