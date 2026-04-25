import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { createTestApp } from '../helpers/app-factory';
import { cleanDatabase } from '../helpers/db-cleaner';
import {
  getTestPrisma,
  disconnectTestPrisma,
} from '../helpers/prisma-test-client';

const USER_EMAIL = 'login@example.com';
const USER_PASSWORD = 'Password1!';

const REGISTER_BODY = {
  first_name: 'Login',
  last_name: 'User',
  email: USER_EMAIL,
  password: USER_PASSWORD,
  confirm_password: USER_PASSWORD,
  is_clinical: false,
};

async function doFullSetup(
  server: ReturnType<INestApplication['getHttpServer']>,
  mailMock: jest.Mock,
) {
  const r1 = await request(server)
    .post('/v1/auth/register/personal')
    .send(REGISTER_BODY);
  const otp = mailMock.mock.calls[0][1] as string;
  const r2 = await request(server)
    .post('/v1/auth/register/verify-email')
    .send({ registration_token: r1.body.data.registration_token, code: otp });
  await request(server).post('/v1/auth/register/organization').send({
    registration_token: r2.body.data.registration_token,
    organization_name: 'Login Clinic',
    branch_address: '1 St',
    branch_city: 'Cairo',
    branch_governate: 'Cairo',
  });
}

describe('POST /v1/auth/login (E2E)', () => {
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
    await doFullSetup(app.getHttpServer(), mailMock);
  });

  it('returns 200 with access and refresh tokens for valid credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: USER_EMAIL, password: USER_PASSWORD })
      .expect(200);

    expect(res.body.data).toHaveProperty('access_token');
    expect(res.body.data).toHaveProperty('refresh_token');
    expect(res.body.data.token_type).toBe('Bearer');
  });

  it('access_token decodes with correct sub and email claims', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: USER_EMAIL, password: USER_PASSWORD });

    const jwt = new JwtService({});
    const payload = jwt.decode(res.body.data.access_token as string);
    expect(payload.email).toBe(USER_EMAIL);
    expect(payload.sub).toBeDefined();
  });

  it('returns 401 on wrong password', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: USER_EMAIL, password: 'WrongPass1!' })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  it('returns 401 on unknown email', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'ghost@example.com', password: USER_PASSWORD })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  it('returns 401 when account is inactive', async () => {
    const prisma = getTestPrisma();
    await prisma.user.updateMany({
      where: { email: USER_EMAIL },
      data: { is_active: false },
    });

    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: USER_EMAIL, password: USER_PASSWORD })
      .expect(401);

    expect(res.body.error.message).toBe('Account is inactive');
  });

  it('returns 400 on invalid email format', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'not-an-email', password: USER_PASSWORD })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 on missing password', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: USER_EMAIL })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
