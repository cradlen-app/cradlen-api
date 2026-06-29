import { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { createTestApp } from '../../helpers/app-factory';

/**
 * Regression guard for the cleanup-deadlock root cause.
 *
 * The app defines wall-clock @Cron jobs (subscription-expiry every 30m → writes
 * `subscriptions`; registration-cleanup hourly → deletes `users`; overdue-visit
 * sweep nightly). Those tables are in the cleanDatabase TRUNCATE set, so a cron
 * firing mid-suite opens a background transaction that races the
 * `TRUNCATE … CASCADE` in `beforeEach` and intermittently deadlocks (40P01).
 *
 * createTestApp must therefore leave NO cron running. This test boots the real
 * app and asserts exactly that — if someone removes the stop-crons step in the
 * harness, this goes red instead of the deadlock resurfacing as a flake.
 */
describe('Test harness — scheduled jobs are disabled (integration)', () => {
  let app: INestApplication;
  const mailMock = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    app = await createTestApp(mailMock);
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers cron jobs but leaves none running', () => {
    const scheduler = app.get(SchedulerRegistry, { strict: false });
    const jobs = [...scheduler.getCronJobs().values()];

    // Guard the assumption that the app actually defines crons, so this test
    // stays meaningful if the job set changes.
    expect(jobs.length).toBeGreaterThan(0);

    // `cron` v4 exposes `isActive`; every job must be stopped after createTestApp.
    for (const job of jobs) {
      expect((job as unknown as { isActive: boolean }).isActive).toBe(false);
    }
  });
});
