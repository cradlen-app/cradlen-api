import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from '../helpers/app-factory';
import { cleanDatabase } from '../helpers/db-cleaner';
import {
  getTestPrisma,
  disconnectTestPrisma,
} from '../helpers/prisma-test-client';

const REGISTER_BODY = {
  first_name: 'Sara',
  last_name: 'Ali',
  email: 'sara@example.com',
  phone_number: '+201012345678',
  password: 'Password1!',
  confirm_password: 'Password1!',
};

const ORG_BODY = {
  organization_name: 'Test Clinic',
  branch_address: '123 Main St',
  branch_city: 'Cairo',
  branch_governorate: 'Cairo',
  branch_country: 'Egypt',
  is_clinical: false,
};

async function doFullRegistration(
  server: ReturnType<INestApplication['getHttpServer']>,
  mailMock: jest.Mock,
) {
  const r1 = await request(server)
    .post('/v1/auth/register/personal')
    .send(REGISTER_BODY);
  const regToken1 = r1.body.data.registration_token as string;
  const otp = mailMock.mock.calls[0][1] as string;

  const r2 = await request(server)
    .post('/v1/auth/register/verify-email')
    .send({ registration_token: regToken1, code: otp });
  return r2.body.data.registration_token as string;
}

describe('POST /v1/auth/register/organization (E2E)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let verifiedToken: string;

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
    verifiedToken = await doFullRegistration(app.getHttpServer(), mailMock);
  });

  it('returns 201 with access and refresh tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/organization')
      .send({ ...ORG_BODY, registration_token: verifiedToken })
      .expect(201);

    expect(res.body.data).toHaveProperty('access_token');
    expect(res.body.data).toHaveProperty('refresh_token');
    expect(res.body.data.token_type).toBe('Bearer');
    expect(res.body.meta).toEqual({});
  });

  it('creates org, branch, staff, and subscription in DB', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/register/organization')
      .send({ ...ORG_BODY, registration_token: verifiedToken });

    const prisma = getTestPrisma();
    const org = await prisma.organization.findFirst({
      where: { name: ORG_BODY.organization_name },
    });
    expect(org).not.toBeNull();

    const branch = await prisma.branch.findFirst({
      where: { organization_id: org!.id },
    });
    expect(branch?.is_main).toBe(true);

    const staff = await prisma.staff.findFirst({
      where: { organization_id: org!.id },
    });
    expect(staff).not.toBeNull();

    const subscription = await prisma.subscription.findFirst({
      where: { organization_id: org!.id },
    });
    expect(subscription).not.toBeNull();
  });

  it('creates owner and doctor staff rows for clinical owners', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/register/organization')
      .send({
        ...ORG_BODY,
        registration_token: verifiedToken,
        is_clinical: true,
        speciality: 'Cardiology',
        job_title: 'Consultant',
      })
      .expect(201);

    const prisma = getTestPrisma();
    const org = await prisma.organization.findFirst({
      where: { name: ORG_BODY.organization_name },
    });
    expect(org).not.toBeNull();

    const staff = await prisma.staff.findMany({
      where: { organization_id: org!.id, is_deleted: false },
      include: { role: true },
    });

    expect(staff).toHaveLength(2);
    expect(staff.map((s) => s.role.name).sort()).toEqual(['doctor', 'owner']);
    expect(staff.find((s) => s.role.name === 'owner')).toEqual(
      expect.objectContaining({
        is_clinical: false,
        specialty: null,
      }),
    );
    expect(staff.find((s) => s.role.name === 'doctor')).toEqual(
      expect.objectContaining({
        is_clinical: true,
        specialty: 'Cardiology',
        job_title: 'Consultant',
      }),
    );
  });

  it('returns 403 when email not verified (using unverified token)', async () => {
    const r = await request(app.getHttpServer())
      .post('/v1/auth/register/personal')
      .send({ ...REGISTER_BODY, email: 'unverified@example.com' });
    const unverifiedToken = r.body.data.registration_token as string;

    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/organization')
      .send({ ...ORG_BODY, registration_token: unverifiedToken })
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 401 on invalid registration token', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/organization')
      .send({ ...ORG_BODY, registration_token: 'garbage' })
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 on missing organization_name', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/organization')
      .send({
        registration_token: verifiedToken,
        branch_address: '123 St',
        branch_city: 'Cairo',
        branch_governorate: 'Cairo',
        branch_country: 'Egypt',
        is_clinical: false,
      })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
