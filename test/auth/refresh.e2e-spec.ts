import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from '../helpers/app-factory';
import { cleanDatabase } from '../helpers/db-cleaner';
import {
  getTestPrisma,
  disconnectTestPrisma,
} from '../helpers/prisma-test-client';

const USER_EMAIL = 'refresh@example.com';
const USER_PASSWORD = 'Password1!';

async function doFullSetup(
  server: ReturnType<INestApplication['getHttpServer']>,
  mailMock: jest.Mock,
) {
  const r1 = await request(server).post('/v1/auth/register/personal').send({
    first_name: 'Refresh',
    last_name: 'User',
    email: USER_EMAIL,
    password: USER_PASSWORD,
    confirm_password: USER_PASSWORD,
    is_clinical: false,
  });
  const otp = mailMock.mock.calls[0][1] as string;
  const r2 = await request(server)
    .post('/v1/auth/register/verify-email')
    .send({ registration_token: r1.body.data.registration_token, code: otp });
  await request(server).post('/v1/auth/register/organization').send({
    registration_token: r2.body.data.registration_token,
    organization_name: 'Refresh Clinic',
    branch_address: '1 St',
    branch_city: 'Cairo',
    branch_governate: 'Cairo',
  });
  const loginRes = await request(server)
    .post('/v1/auth/login')
    .send({ email: USER_EMAIL, password: USER_PASSWORD });
  return loginRes.body.data as { access_token: string; refresh_token: string };
}

describe('POST /v1/auth/refresh (E2E)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let tokens: { access_token: string; refresh_token: string };

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
    tokens = await doFullSetup(app.getHttpServer(), mailMock);
  });

  it('returns 200 with new token pair', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refresh_token: tokens.refresh_token })
      .expect(200);

    expect(res.body.data).toHaveProperty('access_token');
    expect(res.body.data).toHaveProperty('refresh_token');
    expect(res.body.data.refresh_token).not.toBe(tokens.refresh_token);
  });

  it('revokes old token in DB after refresh', async () => {
    const prisma = getTestPrisma();
    const before = await prisma.refreshToken.findFirst({
      where: { is_revoked: false },
    });

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refresh_token: tokens.refresh_token });

    const after = await prisma.refreshToken.findFirst({
      where: { id: before!.id },
    });
    expect(after?.is_revoked).toBe(true);
  });

  it('returns 401 on reuse of old refresh token (JTI revocation)', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refresh_token: tokens.refresh_token });

    const res = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refresh_token: tokens.refresh_token })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 on garbage token', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refresh_token: 'garbage' })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when access token is used as refresh token', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refresh_token: tokens.access_token })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 on missing refresh_token field', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
