import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { createTestApp } from '../helpers/app-factory';
import { cleanDatabase } from '../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../helpers/prisma-test-client';

const OWNER_EMAIL = 'settings-owner@example.com';
const DOCTOR_EMAIL = 'settings-doctor@example.com';
const PASSWORD = 'Password1!';

async function registerOwner(
  server: ReturnType<INestApplication['getHttpServer']>,
  mailMock: jest.Mock,
) {
  const personal = await request(server)
    .post('/v1/auth/register/personal')
    .send({
      first_name: 'Owner',
      last_name: 'User',
      email: OWNER_EMAIL,
      phone_number: '+201012345678',
      password: PASSWORD,
      confirm_password: PASSWORD,
    });
  const otp = mailMock.mock.calls[0][1] as string;
  const verified = await request(server)
    .post('/v1/auth/register/verify-email')
    .send({
      registration_token: personal.body.data.registration_token,
      code: otp,
    });
  await request(server).post('/v1/auth/register/organization').send({
    registration_token: verified.body.data.registration_token,
    organization_name: 'Settings Clinic',
    branch_address: '1 Main St',
    branch_city: 'Cairo',
    branch_governorate: 'Cairo',
    branch_country: 'Egypt',
    is_clinical: false,
  });
  const login = await request(server)
    .post('/v1/auth/login')
    .send({ email: OWNER_EMAIL, password: PASSWORD });
  const me = await request(server)
    .get('/v1/auth/me')
    .set('Authorization', `Bearer ${login.body.data.access_token}`);

  return {
    accessToken: login.body.data.access_token as string,
    refreshToken: login.body.data.refresh_token as string,
    organizationId: me.body.data.profiles[0].organization.id as string,
    branchId: me.body.data.profiles[0].branch.id as string,
  };
}

async function createDoctor(organizationId: string, branchId: string) {
  const prisma = getTestPrisma();
  const doctorRole = await prisma.role.findUniqueOrThrow({
    where: { name: 'doctor' },
  });
  const password_hashed = await bcrypt.hash(PASSWORD, 12);
  const user = await prisma.user.create({
    data: {
      first_name: 'Doctor',
      last_name: 'User',
      email: DOCTOR_EMAIL,
      password_hashed,
      registration_status: 'ACTIVE',
      verified_at: new Date(),
      profile: { create: {} },
    },
  });
  await prisma.staff.create({
    data: {
      user_id: user.id,
      organization_id: organizationId,
      branch_id: branchId,
      role_id: doctorRole.id,
      is_clinical: true,
      specialty: 'Cardiology',
      job_title: 'Doctor',
    },
  });
}

describe('Settings mutations (E2E)', () => {
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

  it('requires authentication for settings mutations', async () => {
    await request(app.getHttpServer())
      .patch('/v1/account/profile')
      .send({ first_name: 'Nope' })
      .expect(401);
  });

  it('lets owners create, edit, and soft-delete branches', async () => {
    const owner = await registerOwner(app.getHttpServer(), mailMock);

    const created = await request(app.getHttpServer())
      .post('/v1/owner/branches')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        organization_id: owner.organizationId,
        address: '2 Side St',
        city: 'Giza',
        governorate: 'Giza',
        country: 'Egypt',
        is_main: true,
      })
      .expect(201);

    expect(created.body.data.branch.is_main).toBe(true);

    const updated = await request(app.getHttpServer())
      .patch(`/v1/owner/branches/${created.body.data.branch.id}`)
      .query({ organization_id: owner.organizationId })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ address: '3 Updated St' })
      .expect(200);

    expect(updated.body.data.branch.address).toBe('3 Updated St');

    await request(app.getHttpServer())
      .delete(`/v1/owner/branches/${created.body.data.branch.id}`)
      .query({ organization_id: owner.organizationId })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const branch = await getTestPrisma().branch.findUnique({
      where: { id: created.body.data.branch.id },
    });
    expect(branch?.is_deleted).toBe(true);
    expect(branch?.status).toBe('INACTIVE');
  });

  it('blocks deleting the only active branch', async () => {
    const owner = await registerOwner(app.getHttpServer(), mailMock);

    await request(app.getHttpServer())
      .delete(`/v1/owner/branches/${owner.branchId}`)
      .query({ organization_id: owner.organizationId })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(400);
  });

  it('prevents doctors from mutating organization settings', async () => {
    const owner = await registerOwner(app.getHttpServer(), mailMock);
    await createDoctor(owner.organizationId, owner.branchId);
    const doctorLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: DOCTOR_EMAIL, password: PASSWORD });

    await request(app.getHttpServer())
      .patch(`/v1/owner/organizations/${owner.organizationId}`)
      .set('Authorization', `Bearer ${doctorLogin.body.data.access_token}`)
      .send({ name: 'Doctor Rename' })
      .expect(403);
  });

  it('filters soft-deleted organizations from auth/me', async () => {
    const owner = await registerOwner(app.getHttpServer(), mailMock);

    await request(app.getHttpServer())
      .delete(`/v1/owner/organizations/${owner.organizationId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(me.body.data.profiles).toEqual([]);
  });

  it('deactivates account and revokes refresh tokens', async () => {
    const owner = await registerOwner(app.getHttpServer(), mailMock);

    await request(app.getHttpServer())
      .post('/v1/account/deactivate')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ reason: 'Closing account' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refresh_token: owner.refreshToken })
      .expect(401);
  });
});
