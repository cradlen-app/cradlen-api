import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from '../helpers/app-factory';
import { cleanDatabase } from '../helpers/db-cleaner';
import {
  getTestPrisma,
  disconnectTestPrisma,
} from '../helpers/prisma-test-client';

describe('POST /v1/auth/register/personal (E2E)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;

  const validBody = {
    first_name: 'John',
    last_name: 'Doe',
    email: 'john@example.com',
    password: 'Password1!',
    confirm_password: 'Password1!',
    is_clinical: false,
  };

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

  it('returns 201 with registration_token and sends OTP email', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/personal')
      .send(validBody)
      .expect(201);

    expect(res.body.data).toHaveProperty('registration_token');
    expect(res.body.data).toHaveProperty('expires_in');
    expect(res.body.meta).toEqual({});
    expect(mailMock).toHaveBeenCalledTimes(1);
    expect(mailMock).toHaveBeenCalledWith(validBody.email, expect.any(String));
  });

  it('sets x-request-id header on response', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/personal')
      .send(validBody);

    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('returns 409 on duplicate email', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/register/personal')
      .send(validBody);

    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/personal')
      .send(validBody)
      .expect(409);

    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 400 on missing first_name', async () => {
    const { first_name: _, ...body } = validBody;
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/personal')
      .send(body)
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 on invalid email format', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/personal')
      .send({ ...validBody, email: 'not-an-email' })
      .expect(400);

    expect(res.body.error.details.fields).toHaveProperty('email');
  });

  it('returns 400 on mismatched passwords', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/personal')
      .send({ ...validBody, confirm_password: 'Different1!' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 on unknown field (forbidNonWhitelisted)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/personal')
      .send({ ...validBody, hacked_field: true })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 on clinical user without speciality', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/personal')
      .send({ ...validBody, is_clinical: true })
      .expect(400);

    expect(res.body.error).toBeDefined();
  });
});
