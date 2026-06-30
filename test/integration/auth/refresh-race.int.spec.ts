import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';

const PASSWORD = 'Password1!';

/**
 * Integration coverage for refresh-token rotation + the reuse grace window
 * (SessionsService.REFRESH_REUSE_GRACE_MS). The unit tests prove the
 * guarded-updateMany pattern; this proves Postgres + Prisma + the request layer
 * behave the way that pattern requires AND pins the grace-window semantics so a
 * change to the window is a deliberate, reviewed act:
 *
 *   - a token revoked *by rotation* (replaced_by_jti set) is honored once more
 *     within the window — this absorbs the concurrent-refresh race;
 *   - the same token is rejected once the window has elapsed;
 *   - a token revoked by *logout* (replaced_by_jti null) is never honored, even
 *     inside the window.
 *
 * NOTE: this suite was previously dormant — it was named `refresh-race.int-spec.ts`
 * (hyphen), which `testMatch: **\/*.spec.ts` never selected, so the rotation-race
 * guarantee ran in CI exactly zero times. Renaming it surfaced that the old
 * "rotated token cannot be replayed -> 401" assertion no longer matches the live
 * grace window (it now returns 200 within the window); the assertions below
 * encode the current, intended behavior.
 */
describe('Auth — refresh-token rotation race + reuse grace window (integration)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;

  beforeAll(async () => {
    mailMock = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp(mailMock);
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestPrisma();
  });

  beforeEach(async () => {
    await cleanDatabase(getTestPrisma());
    mailMock.mockClear();
  });

  async function bootstrap(): Promise<{ access: string; refresh: string }> {
    const http = app.getHttpServer();
    const start = await request(http)
      .post('/v1/auth/signup/start')
      .send({
        first_name: 'Sara',
        last_name: 'Ali',
        email: 'sara@example.com',
        password: PASSWORD,
        confirm_password: PASSWORD,
      })
      .expect(201);
    const otp = mailMock.mock.calls[0][1] as string;
    const verified = await request(http)
      .post('/v1/auth/signup/verify')
      .send({ signup_token: start.body.data.signup_token, code: otp })
      .expect(200);
    const complete = await request(http)
      .post('/v1/auth/signup/complete')
      .send({
        signup_token: verified.body.data.signup_token,
        organization_name: 'Cradlen Clinic',
        specialties: ['OBGYN'],
        branch_name: 'Main',
        branch_address: '1 St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
      })
      .expect(201);
    const tokens = await request(http)
      .post('/v1/auth/profiles/select')
      .send({
        selection_token: complete.body.data.selection_token,
        profile_id: complete.body.data.profiles[0].profile_id,
        branch_id: complete.body.data.profiles[0].branches[0].branch_id,
      })
      .expect(200);
    return {
      access: tokens.body.data.access_token,
      refresh: tokens.body.data.refresh_token,
    };
  }

  it('concurrent refreshes of the same token never hard-logout the user (grace absorbs the race)', async () => {
    const { refresh } = await bootstrap();
    const http = app.getHttpServer();

    const baseRowCount = await getTestPrisma().refreshToken.count();
    expect(baseRowCount).toBe(1);

    const [first, second] = await Promise.allSettled([
      request(http).post('/v1/auth/refresh').send({ refresh_token: refresh }),
      request(http).post('/v1/auth/refresh').send({ refresh_token: refresh }),
    ]);

    const statuses = [first, second].map((r) =>
      r.status === 'fulfilled' ? r.value.status : 500,
    );
    // At least one refresh must succeed, and neither may 5xx — the whole point
    // of the grace window is that a racing page is not spuriously logged out.
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    expect(statuses.some((s) => s >= 500)).toBe(false);
    // Every losing request, if any, returns a clean 401 (not a 500).
    expect(statuses.every((s) => s === 200 || s === 401)).toBe(true);
  });

  it('a rotated token is honored once more within the grace window (200)', async () => {
    const { refresh } = await bootstrap();
    const http = app.getHttpServer();

    // First refresh rotates the token (revokes it, sets replaced_by_jti).
    await request(http)
      .post('/v1/auth/refresh')
      .send({ refresh_token: refresh })
      .expect(200);

    // The original token is now revoked-by-rotation; presenting it again inside
    // the 5-minute window is honored (grace) and mints a fresh pair.
    const replay = await request(http)
      .post('/v1/auth/refresh')
      .send({ refresh_token: refresh })
      .expect(200);
    expect(replay.body.data.access_token).toBeDefined();

    const rows = await getTestPrisma().refreshToken.findMany();
    const rotated = rows.filter((r) => r.is_revoked && r.replaced_by_jti);
    expect(rotated.length).toBeGreaterThanOrEqual(1);
  });

  it('a rotated token is rejected once the grace window has elapsed (401)', async () => {
    const { refresh } = await bootstrap();
    const http = app.getHttpServer();

    await request(http)
      .post('/v1/auth/refresh')
      .send({ refresh_token: refresh })
      .expect(200);

    // Backdate the rotation past the grace window without waiting 5 real minutes.
    await getTestPrisma().refreshToken.updateMany({
      where: { is_revoked: true },
      data: { revoked_at: new Date(Date.now() - 6 * 60 * 1000) },
    });

    await request(http)
      .post('/v1/auth/refresh')
      .send({ refresh_token: refresh })
      .expect(401);
  });

  it('a logout-revoked token is never honored, even inside the grace window (401)', async () => {
    const { refresh } = await bootstrap();
    const http = app.getHttpServer();

    // Logout revokes the token WITHOUT setting replaced_by_jti — a hard
    // revocation, outside the rotation-grace path.
    await request(http)
      .post('/v1/auth/logout')
      .send({ refresh_token: refresh })
      .expect(204);

    const [row] = await getTestPrisma().refreshToken.findMany();
    expect(row.is_revoked).toBe(true);
    expect(row.replaced_by_jti).toBeNull();

    // Immediately (well within 5 minutes) the logged-out token is still rejected.
    await request(http)
      .post('/v1/auth/refresh')
      .send({ refresh_token: refresh })
      .expect(401);
  });
});
