import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';

const PASSWORD = 'Password1!';

/**
 * Integration coverage for S-02. The unit tests prove the
 * guarded-updateMany pattern; this proves Postgres + Prisma
 * + the request layer actually behave the way that pattern
 * requires.
 */
describe('Auth — refresh-token rotation race (integration)', () => {
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

  async function bootstrap(): Promise<{
    access: string;
    refresh: string;
  }> {
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

  it('two parallel refreshes with the same token: exactly one succeeds, the other 401s, only one new row created', async () => {
    const { refresh } = await bootstrap();
    const http = app.getHttpServer();

    const baseRowCount = await getTestPrisma().refreshToken.count();
    expect(baseRowCount).toBe(1);

    const [first, second] = await Promise.allSettled([
      request(http).post('/v1/auth/refresh').send({ refresh_token: refresh }),
      request(http).post('/v1/auth/refresh').send({ refresh_token: refresh }),
    ]);

    const oks = [first, second].filter(
      (r) => r.status === 'fulfilled' && r.value.status === 200,
    );
    const fails = [first, second].filter(
      (r) => r.status === 'fulfilled' && r.value.status !== 200,
    );

    expect(oks).toHaveLength(1);
    expect(fails).toHaveLength(1);

    // Only one new refresh-token row was created.
    const rows = await getTestPrisma().refreshToken.findMany({
      orderBy: { created_at: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].is_revoked).toBe(true);
    expect(rows[1].is_revoked).toBe(false);
  });

  it('a successfully-rotated token cannot be replayed', async () => {
    const { refresh } = await bootstrap();
    const http = app.getHttpServer();

    await request(http)
      .post('/v1/auth/refresh')
      .send({ refresh_token: refresh })
      .expect(200);
    await request(http)
      .post('/v1/auth/refresh')
      .send({ refresh_token: refresh })
      .expect(401);
  });
});
