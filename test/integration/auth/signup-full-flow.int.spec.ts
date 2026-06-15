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
 * Canonical auth happy-path exercised end-to-end against a real
 * Postgres + the canonical seed (OWNER role, free_trial subscription,
 * OBGYN specialty). Covers the structural promises that unit tests
 * mock out: signup writes to `users`, complete writes to
 * `organizations`/`branches`/`profiles`/`subscriptions`, login issues
 * a usable selection token, select issues a usable access+refresh
 * pair, refresh rotates the refresh row, and getMe returns the
 * expected shape.
 */
describe('Auth — full signup → login → refresh → me (integration)', () => {
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

  it('signup → verify → complete → login → select → refresh → me works against a real database', async () => {
    const http = app.getHttpServer();

    // 1. signup/start
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
    const signupToken1 = start.body.data.signup_token as string;
    const otp = mailMock.mock.calls[0][1] as string;

    // The user row exists but no tenant rows yet.
    expect(await getTestPrisma().user.count()).toBe(1);
    expect(await getTestPrisma().organization.count()).toBe(0);

    // 2. signup/verify
    const verified = await request(http)
      .post('/v1/auth/signup/verify')
      .send({ signup_token: signupToken1, code: otp })
      .expect(200);
    const signupToken2 = verified.body.data.signup_token as string;

    // 3. signup/complete
    const complete = await request(http)
      .post('/v1/auth/signup/complete')
      .send({
        signup_token: signupToken2,
        organization_name: 'Cradlen Clinic',
        specialties: ['OBGYN'],
        branch_name: 'Main',
        branch_address: '1 Clinic St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
        branch_country: 'Egypt',
      })
      .expect(201);
    expect(complete.body.data.type).toBe('profile_selection');
    expect(complete.body.data.profiles).toHaveLength(1);
    const profile = complete.body.data.profiles[0];
    expect(profile.organization_name).toBe('Cradlen Clinic');
    expect(profile.roles).toEqual(['OWNER']);
    expect(profile.branches).toHaveLength(1);

    // Tenant rows materialized.
    expect(await getTestPrisma().organization.count()).toBe(1);
    expect(await getTestPrisma().profile.count()).toBe(1);
    expect(await getTestPrisma().subscription.count()).toBe(1);

    // 4. login (returns a fresh selection_token; old one is gone)
    const login = await request(http)
      .post('/v1/auth/login')
      .send({ email: 'sara@example.com', password: PASSWORD })
      .expect(200);
    expect(login.body.data.type).toBe('profile_selection');

    // 5. profiles/select → access + refresh tokens
    const tokens = await request(http)
      .post('/v1/auth/profiles/select')
      .send({
        selection_token: login.body.data.selection_token,
        profile_id: login.body.data.profiles[0].profile_id,
        branch_id: login.body.data.profiles[0].branches[0].branch_id,
      })
      .expect(200);
    expect(tokens.body.data.access_token).toEqual(expect.any(String));
    expect(tokens.body.data.refresh_token).toEqual(expect.any(String));

    // A refresh-token row was created.
    expect(await getTestPrisma().refreshToken.count()).toBe(1);

    // 6. refresh — rotates the row.
    const refreshed = await request(http)
      .post('/v1/auth/refresh')
      .send({ refresh_token: tokens.body.data.refresh_token })
      .expect(200);
    expect(refreshed.body.data.refresh_token).not.toBe(
      tokens.body.data.refresh_token,
    );

    // Old row is_revoked=true, new row exists, total = 2.
    const refreshRows = await getTestPrisma().refreshToken.findMany({
      orderBy: { created_at: 'asc' },
    });
    expect(refreshRows).toHaveLength(2);
    expect(refreshRows[0].is_revoked).toBe(true);
    expect(refreshRows[1].is_revoked).toBe(false);

    // 7. /auth/me with the new access token.
    const me = await request(http)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.data.access_token}`)
      .expect(200);
    expect(me.body.data.email).toBe('sara@example.com');
    expect(me.body.data.profiles).toHaveLength(1);
    expect(me.body.data.profiles[0].roles[0].name).toBe('OWNER');
  });
});
