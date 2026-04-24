import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from '../helpers/app-factory';
import { cleanDatabase } from '../helpers/db-cleaner';
import { getTestPrisma, disconnectTestPrisma } from '../helpers/prisma-test-client';

const USER_EMAIL = 'logout@example.com';
const USER_PASSWORD = 'Password1!';

async function doFullSetup(server: ReturnType<INestApplication['getHttpServer']>, mailMock: jest.Mock) {
  const r1 = await request(server).post('/v1/auth/register/personal').send({
    first_name: 'Logout', last_name: 'User', email: USER_EMAIL,
    password: USER_PASSWORD, confirm_password: USER_PASSWORD, is_clinical: false,
  });
  const otp = mailMock.mock.calls[0][1] as string;
  const r2 = await request(server)
    .post('/v1/auth/register/verify-email')
    .send({ registration_token: r1.body.data.registration_token, code: otp });
  await request(server)
    .post('/v1/auth/register/organization')
    .send({
      registration_token: r2.body.data.registration_token,
      organization_name: 'Logout Clinic',
      branch_address: '1 St', branch_city: 'Cairo', branch_governate: 'Cairo',
    });
  const loginRes = await request(server)
    .post('/v1/auth/login')
    .send({ email: USER_EMAIL, password: USER_PASSWORD });
  return loginRes.body.data.refresh_token as string;
}

describe('POST /v1/auth/logout (E2E)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let refreshToken: string;

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
    refreshToken = await doFullSetup(app.getHttpServer(), mailMock);
  });

  it('returns 204 with empty body on valid refresh token', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .send({ refresh_token: refreshToken })
      .expect(204);

    expect(res.body).toEqual({});
  });

  it('revokes token in DB', async () => {
    const prisma = getTestPrisma();
    const before = await prisma.refreshToken.findFirst({ where: { is_revoked: false } });

    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .send({ refresh_token: refreshToken });

    const after = await prisma.refreshToken.findFirst({ where: { id: before!.id } });
    expect(after?.is_revoked).toBe(true);
  });

  it('returns 204 silently on garbage token (idempotent)', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .send({ refresh_token: 'garbage-token' })
      .expect(204);
  });

  it('returns 204 on already-revoked token', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .send({ refresh_token: refreshToken });

    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .send({ refresh_token: refreshToken })
      .expect(204);
  });

  it('returns 400 on missing refresh_token field', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
