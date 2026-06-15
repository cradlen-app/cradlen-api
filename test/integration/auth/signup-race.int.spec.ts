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
 * Two parallel /v1/auth/signup/complete calls with the same signup token.
 * The transactional updateMany that claims onboarding_completed=true must
 * make sure exactly one request wins: one 201 + one 409, exactly one
 * organization / profile / subscription row created.
 */
describe('Auth — concurrent signup/complete race (integration)', () => {
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

  it('two parallel signup/complete with the same token: exactly one 201, one 409, one organization', async () => {
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
    const signupToken = verified.body.data.signup_token as string;

    const body = {
      signup_token: signupToken,
      organization_name: 'Cradlen Clinic',
      specialties: ['OBGYN'],
      branch_name: 'Main',
      branch_address: '1 St',
      branch_city: 'Cairo',
      branch_governorate: 'Cairo',
    };

    const results = await Promise.allSettled([
      request(http).post('/v1/auth/signup/complete').send(body),
      request(http).post('/v1/auth/signup/complete').send(body),
    ]);

    const fulfilled = results.filter(
      (r) => r.status === 'fulfilled',
    ) as PromiseFulfilledResult<request.Response>[];

    const statuses = fulfilled.map((r) => r.value.status).sort();
    expect(statuses).toEqual([201, 409]);

    // Exactly one organization, one profile, one subscription.
    expect(await getTestPrisma().organization.count()).toBe(1);
    expect(await getTestPrisma().profile.count()).toBe(1);
    expect(await getTestPrisma().subscription.count()).toBe(1);
  });
});
