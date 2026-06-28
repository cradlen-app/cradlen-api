import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import type { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';
import { bearer } from '../../helpers/auth-helpers';
import { seedOrg } from '../../helpers/financial-helpers';

/**
 * GET /v1/patients/search — the GLOBAL book-visit autocomplete. By product design
 * `Patient` is a global master index, so a clinic can find a patient first
 * registered anywhere by name OR national id. The caller's own enrolled patients
 * rank first.
 *
 * SECURITY (F7): search returns disambiguation-only fields (full_name + last 3 of
 * phone) — NEVER cross-org national id / DOB / address / full phone, which would
 * make the shared registry bulk-harvestable. Full identity is revealed one record
 * at a time, on explicit selection, via GET /v1/patients/:id/identity (throttled +
 * audited).
 */
describe('Patients — global lookup for booking autocomplete (integration)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let prisma: PrismaClient;
  const jwt = new JwtService({});

  beforeAll(async () => {
    mailMock = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp(mailMock);
    prisma = getTestPrisma();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestPrisma();
  });

  let auth: (r: request.Test) => request.Test;
  let callerOrgId: string;

  beforeEach(async () => {
    await cleanDatabase(prisma);
    await (
      prisma as unknown as {
        $executeRawUnsafe: (sql: string) => Promise<unknown>;
      }
    ).$executeRawUnsafe('TRUNCATE TABLE "patients" CASCADE');
    mailMock.mockClear();

    const org = await seedOrg(
      prisma,
      'Caller Org',
      `caller-${Date.now()}@ex.com`,
    );
    callerOrgId = org.org.id;
    const userId = (
      await prisma.profile.findUniqueOrThrow({
        where: { id: org.ownerProfileId },
        select: { user_id: true },
      })
    ).user_id;
    auth = bearer(
      jwt.sign(
        {
          userId,
          profileId: org.ownerProfileId,
          organizationId: org.org.id,
          type: 'access',
        },
        { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: '15m' },
      ),
    );
  });

  async function createPatient(
    fullName: string,
    nationalId: string,
    phone: string,
    enrollInCallerOrg = false,
  ): Promise<string> {
    const p = await prisma.patient.create({
      data: {
        national_id: nationalId,
        full_name: fullName,
        date_of_birth: new Date('1990-01-01'),
        phone_number: phone,
        address: '10 Nile St',
      },
    });
    if (enrollInCallerOrg) {
      await prisma.patientOrgEnrollment.create({
        data: {
          patient_id: p.id,
          organization_id: callerOrgId,
          status: 'ACTIVE',
        },
      });
    }
    return p.id;
  }

  const search = (q: string) =>
    auth(
      request(app.getHttpServer()).get(
        `/v1/patients/search?search=${encodeURIComponent(q)}`,
      ),
    );

  it('finds a cross-org patient by partial name — disambiguation fields only', async () => {
    await createPatient('Mariam Adel', 'NID-111222333', '+201000000001');
    const res = await search('Mariam').expect(200);
    expect(res.body.data).toHaveLength(1);
    const row = res.body.data[0];
    expect(row.full_name).toBe('Mariam Adel');
    expect(row.phone_last3).toBe('001');
    // SECURITY: no cross-org PII is exposed by the search itself.
    expect(row.national_id).toBeUndefined();
    expect(row.phone_number).toBeUndefined();
    expect(row.date_of_birth).toBeUndefined();
    expect(row.address).toBeUndefined();
    expect(Object.keys(row).sort()).toEqual(['full_name', 'id', 'phone_last3']);
  });

  it('finds a cross-org patient by partial national id (still no PII returned)', async () => {
    await createPatient('Omar Khaled', 'NID-555444333', '+201000000002');
    const res = await search('NID-555').expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].full_name).toBe('Omar Khaled');
    expect(res.body.data[0].national_id).toBeUndefined();
  });

  it('GET /patients/:id/identity reveals full identity for a chosen cross-org patient', async () => {
    const id = await createPatient(
      'Hana Said',
      'NID-777888999',
      '+201000000009',
    );
    const res = await auth(
      request(app.getHttpServer()).get(`/v1/patients/${id}/identity`),
    ).expect(200);
    const row = res.body.data;
    expect(row.full_name).toBe('Hana Said');
    expect(row.national_id).toBe('NID-777888999');
    expect(row.phone_number).toBe('+201000000009');
    expect(row).toHaveProperty('date_of_birth');
    expect(row).toHaveProperty('address');
  });

  it('GET /patients/:id/identity returns 404 for an unknown id', async () => {
    await auth(
      request(app.getHttpServer()).get(
        '/v1/patients/00000000-0000-0000-0000-000000000000/identity',
      ),
    ).expect(404);
  });

  it("ranks the caller's own enrolled patient first", async () => {
    await createPatient('Sara Other', 'NID-900000001', '+201000000003', false);
    await createPatient('Sara Own', 'NID-900000002', '+201000000004', true);
    const res = await search('Sara').expect(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data[0].full_name).toBe('Sara Own');
  });

  it('rejects a single-character query (min length)', async () => {
    await search('a').expect(400);
  });
});
