import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { createTestApp } from '../helpers/app-factory';
import { cleanDatabase } from '../helpers/db-cleaner';
import {
  getTestPrisma,
  disconnectTestPrisma,
} from '../helpers/prisma-test-client';

const USER_EMAIL = 'me@example.com';
const USER_PASSWORD = 'Password1!';

async function doFullSetup(
  server: ReturnType<INestApplication['getHttpServer']>,
  mailMock: jest.Mock,
) {
  const r1 = await request(server).post('/v1/auth/register/personal').send({
    first_name: 'Me',
    last_name: 'User',
    email: USER_EMAIL,
    phone_number: '+201012345678',
    password: USER_PASSWORD,
    confirm_password: USER_PASSWORD,
  });
  const otp = mailMock.mock.calls[0][1] as string;
  const r2 = await request(server)
    .post('/v1/auth/register/verify-email')
    .send({ registration_token: r1.body.data.registration_token, code: otp });
  await request(server).post('/v1/auth/register/organization').send({
    registration_token: r2.body.data.registration_token,
    organization_name: 'Me Clinic',
    branch_address: '1 St',
    branch_city: 'Cairo',
    branch_governorate: 'Cairo',
    branch_country: 'Egypt',
    is_clinical: false,
  });
  const loginRes = await request(server)
    .post('/v1/auth/login')
    .send({ email: USER_EMAIL, password: USER_PASSWORD });
  return loginRes.body.data.access_token as string;
}

describe('GET /v1/auth/me (E2E)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let accessToken: string;

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
    accessToken = await doFullSetup(app.getHttpServer(), mailMock);
  });

  it('returns 200 with user profile', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.email).toBe(USER_EMAIL);
    expect(res.body.data.first_name).toBe('Me');
    expect(res.body.data).toHaveProperty('is_active');
    expect(res.body.data).toHaveProperty('verified_at');
    expect(res.body.meta).toEqual({});
  });

  it('returns 401 with no Authorization header', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .expect(401);
    expect(res.body.error).toBeDefined();
  });

  it('returns 401 with garbage bearer token', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', 'Bearer garbage-token')
      .expect(401);

    expect(res.body.error).toBeDefined();
  });

  it('returns 401 when registration token is used instead of access token', async () => {
    const r = await request(app.getHttpServer())
      .post('/v1/auth/register/personal')
      .send({
        first_name: 'Tmp',
        last_name: 'Tmp',
        email: 'tmp@example.com',
        phone_number: '+201012345679',
        password: USER_PASSWORD,
        confirm_password: USER_PASSWORD,
      });
    const regToken = r.body.data.registration_token as string;

    const res = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${regToken}`)
      .expect(401);

    expect(res.body.error).toBeDefined();
  });

  it('returns 401 when user is soft-deleted', async () => {
    const prisma = getTestPrisma();
    await prisma.user.updateMany({
      where: { email: USER_EMAIL },
      data: { is_deleted: true },
    });

    const res = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);

    expect(res.body.error).toBeDefined();
  });

  it('returns 401 when user is inactive', async () => {
    const prisma = getTestPrisma();
    await prisma.user.updateMany({
      where: { email: USER_EMAIL },
      data: { is_active: false },
    });

    const res = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);

    expect(res.body.error).toBeDefined();
  });

  it('returns 401 for expired access token', async () => {
    const jwt = new JwtService({});
    const payload = jwt.decode(accessToken);
    const expiredToken = jwt.sign(
      { sub: payload.sub, email: payload.email },
      { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: '-1s' },
    );

    const res = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);

    expect(res.body.error).toBeDefined();
  });
});
