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
 * GET /v1/patients/search is a deliberate CROSS-ORG identity lookup (book-visit
 * autocomplete — find a patient first registered at another clinic). Because it
 * crosses tenants it must NOT become a scraper: it matches an EXACT national id
 * or phone only (no fuzzy / name search) and returns a minimal {id, full_name}
 * projection, so an authenticated user of any org cannot enumerate or harvest
 * the multi-tenant patient population's PII (national id / DOB / address).
 */
describe('Patients — global search hardening (integration security)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let prisma: PrismaClient;
  const jwt = new JwtService({});

  const NID = 'NID-9988776655';
  const PHONE = '+201234567890';
  const NAME = 'Salma Ibrahim';

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

  beforeEach(async () => {
    await cleanDatabase(prisma);
    await (
      prisma as unknown as {
        $executeRawUnsafe: (sql: string) => Promise<unknown>;
      }
    ).$executeRawUnsafe('TRUNCATE TABLE "patients" CASCADE');
    mailMock.mockClear();

    // Caller belongs to org A; the target patient is NOT enrolled in org A —
    // proving the lookup is intentionally cross-org while staying minimal.
    const org = await seedOrg(
      prisma,
      'Caller Org',
      `caller-${Date.now()}@ex.com`,
    );
    const token = jwt.sign(
      {
        userId: (
          await prisma.profile.findUniqueOrThrow({
            where: { id: org.ownerProfileId },
            select: { user_id: true },
          })
        ).user_id,
        profileId: org.ownerProfileId,
        organizationId: org.org.id,
        type: 'access',
      },
      { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: '15m' },
    );
    auth = bearer(token);

    await prisma.patient.create({
      data: {
        national_id: NID,
        full_name: NAME,
        date_of_birth: new Date('1990-01-01'),
        phone_number: PHONE,
        address: '12 Secret St',
      },
    });
  });

  const search = (q: string) =>
    auth(
      request(app.getHttpServer()).get(
        `/v1/patients/search?search=${encodeURIComponent(q)}`,
      ),
    );

  it('exact national_id returns the patient with ONLY id + full_name (no PII)', async () => {
    const res = await search(NID).expect(200);
    expect(res.body.data).toHaveLength(1);
    const row = res.body.data[0];
    expect(row.full_name).toBe(NAME);
    expect(row).not.toHaveProperty('national_id');
    expect(row).not.toHaveProperty('date_of_birth');
    expect(row).not.toHaveProperty('address');
    expect(row).not.toHaveProperty('phone_number');
  });

  it('exact phone number resolves the patient (minimal projection)', async () => {
    const res = await search(PHONE).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].full_name).toBe(NAME);
  });

  it('a partial national_id does NOT match (no substring enumeration)', async () => {
    const res = await search('NID-99').expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('a name query does NOT match (name is not a cross-org search key)', async () => {
    const res = await search(NAME).expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('rejects a too-short query (min length guards against probing)', async () => {
    await search('abc').expect(400);
  });
});
