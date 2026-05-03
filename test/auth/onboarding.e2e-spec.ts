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
        email: '  SARA@example.com  ',
        phone_number: '+201012345678',
        password: PASSWORD,
        confirm_password: PASSWORD,
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
        specialties: ['Cardiology'],
        branch_name: 'Main Branch',
        branch_address: '1 Clinic St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
        branch_country: 'Egypt',
        roles: ['OWNER', 'DOCTOR'],
        specialty: 'Cardiology',
        job_title: 'Consultant',
      })
      .expect(201);

    const selected = await request(app.getHttpServer())
      .post('/v1/auth/profiles/select')
      .send({
        selection_token: complete.body.data.selection_token,
        profile_id: complete.body.data.profiles[0].profile_id,
        branch_id: complete.body.data.profiles[0].branches[0].branch_id,
      })
      .expect(200);

    return selected.body.data as {
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
        confirm_password: PASSWORD,
      })
      .expect(201);

    expect(await getTestPrisma().account.count()).toBe(0);
    expect(await getTestPrisma().profile.count()).toBe(0);

    const otp = mailMock.mock.calls[0][1] as string;
    const verified = await request(app.getHttpServer())
      .post('/v1/auth/signup/verify')
      .send({ signup_token: start.body.data.signup_token, code: otp })
      .expect(200);

    const complete = await request(app.getHttpServer())
      .post('/v1/auth/signup/complete')
      .send({
        signup_token: verified.body.data.signup_token,
        account_name: 'Nour Clinic',
        specialties: ['General Medicine'],
        branch_name: 'Main Branch',
        branch_address: '1 Clinic St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
        branch_country: 'Egypt',
        roles: ['OWNER'],
      })
      .expect(201);

    expect(complete.body.data).toEqual(
      expect.objectContaining({
        type: 'profile_selection',
        selection_token: expect.any(String),
        profiles: [
          expect.objectContaining({
            profile_id: expect.any(String),
            account_id: expect.any(String),
            account_name: 'Nour Clinic',
            roles: ['OWNER'],
            branches: [
              expect.objectContaining({
                branch_id: expect.any(String),
                name: 'Main Branch',
                is_main: true,
              }),
            ],
          }),
        ],
      }),
    );

    expect(await getTestPrisma().account.count()).toBe(1);
    expect(await getTestPrisma().profile.count()).toBe(1);
    expect(await getTestPrisma().profileRole.count()).toBe(1);
    expect(await getTestPrisma().profileBranch.count()).toBe(1);
  });

  it('rejects mismatched signup password confirmation', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/signup/start')
      .send({
        first_name: 'Nour',
        last_name: 'Hassan',
        email: 'nour@example.com',
        password: PASSWORD,
        confirm_password: 'Password2!',
      })
      .expect(400);
  });

  it('stores doctor fields only when DOCTOR role is requested', async () => {
    await completeOwnerSignup();

    const doctorProfile = await getTestPrisma().profile.findFirstOrThrow({
      include: { roles: { include: { role: true } } },
    });

    expect(doctorProfile.is_clinical).toBe(true);
    expect(doctorProfile.specialty).toBe('Cardiology');
    expect(doctorProfile.job_title).toBe('Consultant');
    expect(doctorProfile.roles.map((item) => item.role.name).sort()).toEqual([
      'DOCTOR',
      'OWNER',
    ]);
  });

  it('resends signup OTP and invalidates the original code', async () => {
    const start = await request(app.getHttpServer())
      .post('/v1/auth/signup/start')
      .send({
        first_name: 'Nour',
        last_name: 'Hassan',
        email: 'nour@example.com',
        password: PASSWORD,
        confirm_password: PASSWORD,
      })
      .expect(201);

    const originalOtp = mailMock.mock.calls[0][1] as string;

    await request(app.getHttpServer())
      .post('/v1/auth/signup/resend')
      .send({ email: 'nour@example.com' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({ success: true });
      });

    const resentOtp = mailMock.mock.calls[1][1] as string;

    await request(app.getHttpServer())
      .post('/v1/auth/signup/verify')
      .send({ signup_token: start.body.data.signup_token, code: originalOtp })
      .expect(400);

    await request(app.getHttpServer())
      .post('/v1/auth/signup/verify')
      .send({ signup_token: start.body.data.signup_token, code: resentOtp })
      .expect(200);
  });

  it('reports registration status without exposing public email', async () => {
    await request(app.getHttpServer())
      .get('/v1/auth/registration/status')
      .query({ email: 'missing@example.com' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({ step: 'NONE' });
      });

    const start = await request(app.getHttpServer())
      .post('/v1/auth/signup/start')
      .send({
        first_name: 'Nour',
        last_name: 'Hassan',
        email: 'nour@example.com',
        password: PASSWORD,
        confirm_password: PASSWORD,
      })
      .expect(201);

    await request(app.getHttpServer())
      .get('/v1/auth/registration/status')
      .query({ email: 'nour@example.com' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({ step: 'VERIFY_OTP' });
      });

    const otp = mailMock.mock.calls[0][1] as string;
    const verified = await request(app.getHttpServer())
      .post('/v1/auth/signup/verify')
      .send({ signup_token: start.body.data.signup_token, code: otp })
      .expect(200);

    await request(app.getHttpServer())
      .get('/v1/auth/registration/status')
      .query({ email: 'nour@example.com' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({ step: 'COMPLETE_ONBOARDING' });
      });

    const complete = await request(app.getHttpServer())
      .post('/v1/auth/signup/complete')
      .send({
        signup_token: verified.body.data.signup_token,
        account_name: 'Nour Clinic',
        specialties: ['General Medicine'],
        branch_name: 'Main Branch',
        branch_address: '1 Clinic St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
        branch_country: 'Egypt',
        roles: ['OWNER'],
      })
      .expect(201);

    const selected = await request(app.getHttpServer())
      .post('/v1/auth/profiles/select')
      .send({
        selection_token: complete.body.data.selection_token,
        profile_id: complete.body.data.profiles[0].profile_id,
        branch_id: complete.body.data.profiles[0].branches[0].branch_id,
      })
      .expect(200);

    await request(app.getHttpServer())
      .get('/v1/auth/registration/status')
      .query({ email: 'nour@example.com' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({ step: 'DONE' });
      });

    await request(app.getHttpServer())
      .get('/v1/auth/registration/status')
      .set('Authorization', `Bearer ${selected.body.data.access_token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({
          step: 'DONE',
          email: 'nour@example.com',
        });
      });
  });

  it('logs in with profile selection and issues contextual tokens', async () => {
    await completeOwnerSignup();

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: '  SARA@example.com  ', password: PASSWORD })
      .expect(200);

    expect(login.body.data.type).toBe('profile_selection');
    expect(login.body.data.profiles).toEqual([
      expect.objectContaining({
        profile_id: expect.any(String),
        account_id: expect.any(String),
        account_name: 'Cradlen Clinic',
        roles: expect.arrayContaining(['OWNER', 'DOCTOR']),
        branches: [
          expect.objectContaining({
            branch_id: expect.any(String),
            name: 'Main Branch',
            is_main: true,
          }),
        ],
      }),
    ]);

    const selected = await request(app.getHttpServer())
      .post('/v1/auth/profiles/select')
      .send({
        selection_token: login.body.data.selection_token,
        profile_id: login.body.data.profiles[0].profile_id,
        branch_id: login.body.data.profiles[0].branches[0].branch_id,
      })
      .expect(200);

    expect(selected.body.data).toHaveProperty('access_token');
    expect(selected.body.data).toHaveProperty('refresh_token');
  });

  it('requires branch selection for profiles with multiple branches', async () => {
    await completeOwnerSignup();
    const profile = await getTestPrisma().profile.findFirstOrThrow();
    const extraBranch = await getTestPrisma().branch.create({
      data: {
        account_id: profile.account_id,
        name: 'Giza Branch',
        address: '2 Side St',
        city: 'Giza',
        governorate: 'Giza',
      },
    });
    await getTestPrisma().profileBranch.create({
      data: {
        profile_id: profile.id,
        branch_id: extraBranch.id,
        account_id: profile.account_id,
      },
    });

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'sara@example.com', password: PASSWORD })
      .expect(200);

    await request(app.getHttpServer())
      .post('/v1/auth/profiles/select')
      .send({
        selection_token: login.body.data.selection_token,
        profile_id: profile.id,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/v1/auth/profiles/select')
      .send({
        selection_token: login.body.data.selection_token,
        profile_id: profile.id,
        branch_id: extraBranch.id,
      })
      .expect(200);
  });

  it('rejects branch selection outside the selected profile', async () => {
    await completeOwnerSignup();
    const profile = await getTestPrisma().profile.findFirstOrThrow();
    const otherAccount = await getTestPrisma().account.create({
      data: { name: 'Other Clinic' },
    });
    const otherBranch = await getTestPrisma().branch.create({
      data: {
        account_id: otherAccount.id,
        name: 'Other Branch',
        address: '3 Other St',
        city: 'Cairo',
        governorate: 'Cairo',
      },
    });

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'sara@example.com', password: PASSWORD })
      .expect(200);

    await request(app.getHttpServer())
      .post('/v1/auth/profiles/select')
      .send({
        selection_token: login.body.data.selection_token,
        profile_id: profile.id,
        branch_id: otherBranch.id,
      })
      .expect(403);
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
