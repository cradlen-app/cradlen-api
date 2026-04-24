import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from '../helpers/app-factory';
import { cleanDatabase } from '../helpers/db-cleaner';
import { getTestPrisma, disconnectTestPrisma } from '../helpers/prisma-test-client';

const REGISTER_BODY = {
  first_name: 'Alex',
  last_name: 'Smith',
  email: 'alex@example.com',
  password: 'Password1!',
  confirm_password: 'Password1!',
  is_clinical: false,
};

describe('POST /v1/auth/register/resend-otp (E2E)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let registrationToken: string;

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

    // Backdate the initial OTP so the 60s cooldown is already elapsed
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/personal')
      .send(REGISTER_BODY);
    registrationToken = res.body.data.registration_token as string;

    const prisma = getTestPrisma();
    const user = await prisma.user.findFirst({ where: { email: REGISTER_BODY.email } });
    await prisma.emailVerification.updateMany({
      where: { user_id: user!.id },
      data: { created_at: new Date(Date.now() - 90 * 1000) },
    });

    mailMock.mockClear();
  });

  it('returns 200 with new registration token and sends new OTP', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/resend-otp')
      .send({ registration_token: registrationToken })
      .expect(200);

    expect(res.body.data).toHaveProperty('registration_token');
    expect(mailMock).toHaveBeenCalledTimes(1);
  });

  it('marks previous OTP as used after resend', async () => {
    const prisma = getTestPrisma();
    const user = await prisma.user.findFirst({ where: { email: REGISTER_BODY.email } });

    await request(app.getHttpServer())
      .post('/v1/auth/register/resend-otp')
      .send({ registration_token: registrationToken });

    const previousOtps = await prisma.emailVerification.findMany({
      where: { user_id: user!.id, used_at: { not: null } },
    });
    expect(previousOtps.length).toBeGreaterThan(0);
  });

  it('returns 401 when called twice within 60s cooldown', async () => {
    // First resend succeeds
    const res1 = await request(app.getHttpServer())
      .post('/v1/auth/register/resend-otp')
      .send({ registration_token: registrationToken });
    const newToken = res1.body.data.registration_token as string;

    // Immediate second resend triggers cooldown
    const res2 = await request(app.getHttpServer())
      .post('/v1/auth/register/resend-otp')
      .send({ registration_token: newToken })
      .expect(401);

    expect(res2.body.error.message).toContain('Please wait');
  });

  it('returns 401 after max 5 OTP attempts', async () => {
    const prisma = getTestPrisma();
    const user = await prisma.user.findFirst({ where: { email: REGISTER_BODY.email } });

    // Insert 4 more OTPs (1 already exists = 5 total in window)
    for (let i = 0; i < 4; i++) {
      await prisma.emailVerification.create({
        data: {
          user_id: user!.id,
          code_hash: '$2b$06$fakehash',
          expires_at: new Date(Date.now() + 15 * 60 * 1000),
          used_at: new Date(),
        },
      });
    }

    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/resend-otp')
      .send({ registration_token: registrationToken })
      .expect(401);

    expect(res.body.error.message).toContain('Maximum OTP attempts');
  });

  it('returns 401 on invalid token', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/resend-otp')
      .send({ registration_token: 'garbage' })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
