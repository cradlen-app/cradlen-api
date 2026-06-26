import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AdminDailyMetricsService } from './admin-daily-metrics.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcDayKey(msFromTodayStart: number): string {
  const now = new Date();
  const todayStart = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return new Date(todayStart + msFromTodayStart).toISOString().slice(0, 10);
}

describe('AdminDailyMetricsService', () => {
  const makePrisma = (rows: unknown[]) =>
    ({
      db: { dailyMetricSnapshot: { findMany: () => Promise.resolve(rows) } },
    }) as unknown as PrismaService;

  it('returns a contiguous N-day series ending yesterday, seeding gaps with zeros', async () => {
    const service = new AdminDailyMetricsService(makePrisma([]));

    const trend = await service.getDailyTrends(7);

    expect(trend).toHaveLength(7);
    // Oldest first, last point is yesterday.
    expect(trend[6].date).toBe(utcDayKey(-MS_PER_DAY));
    expect(trend[0].date).toBe(utcDayKey(-7 * MS_PER_DAY));
    // Contiguous days, one apart.
    for (let i = 1; i < trend.length; i++) {
      const prev = Date.parse(trend[i - 1].date);
      const cur = Date.parse(trend[i].date);
      expect(cur - prev).toBe(MS_PER_DAY);
    }
    // Missing days are zeroed, not dropped.
    expect(trend[0]).toMatchObject({
      active_staff: 0,
      total_staff: 0,
      active_portals: 0,
      total_portals: 0,
      total_enrolled_patients: 0,
    });
  });

  it('maps a snapshot row onto its day', async () => {
    const yesterday = new Date(utcDayKey(-MS_PER_DAY));
    const service = new AdminDailyMetricsService(
      makePrisma([
        {
          date: yesterday,
          active_staff: 3,
          total_staff: 10,
          active_portals: 5,
          total_portals: 20,
          total_enrolled_patients: 25,
        },
      ]),
    );

    const trend = await service.getDailyTrends(3);
    const point = trend.find((p) => p.date === utcDayKey(-MS_PER_DAY));

    expect(point).toMatchObject({
      active_staff: 3,
      total_staff: 10,
      active_portals: 5,
      total_portals: 20,
      total_enrolled_patients: 25,
    });
  });

  it('defaults to a 30-day window', async () => {
    const service = new AdminDailyMetricsService(makePrisma([]));
    expect(await service.getDailyTrends()).toHaveLength(30);
  });
});
