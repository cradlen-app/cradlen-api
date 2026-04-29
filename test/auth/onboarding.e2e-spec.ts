import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from '../helpers/app-factory';
import { cleanDatabase } from '../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../helpers/prisma-test-client';

const PASSWORD = 'Password1!';

describe('Cradlen onboarding and tenant context (E2E)', () => {
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

  async function completeOwnerSignup() {
    const start = await request(app.getHttpServer())
      .post('/v1/auth/signup/start')
      .send({
        first_name: 'Sara',
        last_name: 'Ali',
        email: 'sara@example.com',
        phone_number: '+201012345678',
        password: PASSWORD,
      })
      .expect(201);

    const otp = mailMock.mock.calls[0][1] as string;
    const verified = await request(app.getHttpServer())
      .post('/v1/auth/signup/verify')
      .send({
        signup_token: start.body.data.signup_token,
        code: otp,
      })
      .expect(200);

    const complete = await request(app.getHttpServer())
      .post('/v1/auth/signup/complete')
      .send({
        signup_token: verified.body.data.signup_token,
        account_name: 'Cradlen Clinic',
        account_specialities: ['Cardiology'],
        branch_name: 'Main Branch',
        branch_address: '1 Main St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
        branch_country: 'Egypt',
        is_clinical: true,
        specialty: 'Cardiology',
        job_title: 'Consultant',
      })
      .expect(201);

    return complete.body.data as {
      access_token: string;
      refresh_token: string;
    };
  }

  it('creates user first, then tenant records only after completion', async () => {
    const start = await request(app.getHttpServer())
      .post('/v1/auth/signup/start')
      .send({
        first_name: 'Nour',
        last_name: 'Hassan',
        email: 'nour@example.com',
        password: PASSWORD,
      })
      .expect(201);

    expect(await getTestPrisma().account.count()).toBe(0);
    expect(await getTestPrisma().profile.count()).toBe(0);

    const otp = mailMock.mock.calls[0][1] as string;
    const verified = await request(app.getHttpServer())
      .post('/v1/auth/signup/verify')
      .send({ signup_token: start.body.data.signup_token, code: otp })
      .expect(200);

    await request(app.getHttpServer())
      .post('/v1/auth/signup/complete')
      .send({
        signup_token: verified.body.data.signup_token,
        account_name: 'Nour Clinic',
        branch_name: 'Main Branch',
        branch_address: '1 Main St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
        is_clinical: false,
      })
      .expect(201);

    expect(await getTestPrisma().account.count()).toBe(1);
    expect(await getTestPrisma().profile.count()).toBe(1);
    expect(await getTestPrisma().profileRole.count()).toBe(1);
    expect(await getTestPrisma().profileBranch.count()).toBe(1);
  });

  it('logs in with profile selection and issues contextual tokens', async () => {
    await completeOwnerSignup();

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'sara@example.com', password: PASSWORD })
      .expect(200);

    expect(login.body.data.type).toBe('profile_selection');
    expect(login.body.data.profiles).toHaveLength(1);

    const selected = await request(app.getHttpServer())
      .post('/v1/auth/profiles/select')
      .send({
        selection_token: login.body.data.selection_token,
        profile_id: login.body.data.profiles[0].id,
      })
      .expect(200);

    expect(selected.body.data).toHaveProperty('access_token');
    expect(selected.body.data).toHaveProperty('refresh_token');
  });

  it('allows owner to create and list account branches', async () => {
    const tokens = await completeOwnerSignup();
    const profile = await getTestPrisma().profile.findFirstOrThrow();

    await request(app.getHttpServer())
      .post(`/v1/accounts/${profile.account_id}/branches`)
      .set('Authorization', `Bearer ${tokens.access_token}`)
      .send({
        name: 'Giza Branch',
        address: '2 Side St',
        city: 'Giza',
        governorate: 'Giza',
        country: 'Egypt',
      })
      .expect(201);

    const branches = await request(app.getHttpServer())
      .get(`/v1/accounts/${profile.account_id}/branches`)
      .set('Authorization', `Bearer ${tokens.access_token}`)
      .expect(200);

    expect(branches.body.data).toHaveLength(2);
  });
});
