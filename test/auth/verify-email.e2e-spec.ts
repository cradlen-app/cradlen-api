import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from '../helpers/app-factory';
import { cleanDatabase } from '../helpers/db-cleaner';
import {
  getTestPrisma,
  disconnectTestPrisma,
} from '../helpers/prisma-test-client';

const REGISTER_BODY = {
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@example.com',
  password: 'Password1!',
  confirm_password: 'Password1!',
  is_clinical: false,
};

describe('POST /v1/auth/register/verify-email (E2E)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let registrationToken: string;
  let otpCode: string;

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

    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/personal')
      .send(REGISTER_BODY);

    registrationToken = res.body.data.registration_token as string;
    otpCode = mailMock.mock.calls[0][1] as string;
  });

  it('returns 200 with new registration token on correct OTP', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/verify-email')
      .send({ registration_token: registrationToken, code: otpCode })
      .expect(200);

    expect(res.body.data).toHaveProperty('registration_token');
    expect(res.body.meta).toEqual({});
  });

  it('marks email as verified in DB', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/register/verify-email')
      .send({ registration_token: registrationToken, code: otpCode });

    const prisma = getTestPrisma();
    const user = await prisma.user.findFirst({
      where: { email: REGISTER_BODY.email },
    });
    expect(user?.verified_at).not.toBeNull();
  });

  it('marks OTP as used in DB', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/register/verify-email')
      .send({ registration_token: registrationToken, code: otpCode });

    const prisma = getTestPrisma();
    const user = await prisma.user.findFirst({
      where: { email: REGISTER_BODY.email },
    });
    const verif = await prisma.emailVerification.findFirst({
      where: { user_id: user!.id },
    });
    expect(verif?.used_at).not.toBeNull();
  });

  it('returns 401 on wrong OTP', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/verify-email')
      .send({ registration_token: registrationToken, code: '000000' })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 on expired OTP', async () => {
    const prisma = getTestPrisma();
    const user = await prisma.user.findFirst({
      where: { email: REGISTER_BODY.email },
    });
    await prisma.emailVerification.updateMany({
      where: { user_id: user!.id },
      data: { expires_at: new Date(Date.now() - 1000) },
    });

    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/verify-email')
      .send({ registration_token: registrationToken, code: otpCode })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 on invalid registration token', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/verify-email')
      .send({ registration_token: 'garbage', code: otpCode })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 when code is not 6 digits', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/verify-email')
      .send({ registration_token: registrationToken, code: '123' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
