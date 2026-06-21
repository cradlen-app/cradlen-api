import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
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
 * `GET /v1/care-paths` org-scope:
 *  - returns system rows (organization_id = null) PLUS the caller's own
 *    org-specific rows;
 *  - never returns another org's private care path;
 *  - `:id` / `:id/episodes` resolve for an accessible (own or system) path and
 *    404 for a foreign private path.
 *
 * NOTE: cleanDatabase issues `TRUNCATE organizations CASCADE`, which (being a
 * table-level cascade) also empties care_paths — every care_paths row has an FK
 * to organizations even when organization_id is null. So we cannot rely on the
 * seeded system rows surviving between tests; rows used here are created inside
 * each test (after beforeEach) and removed in afterEach by their unique code.
 */
describe('Care paths — org-scoped read (integration)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let prisma: PrismaClient;
  const jwt = new JwtService({});

  const CODE_PREFIX = 'BATCH5-CP-';

  beforeAll(async () => {
    mailMock = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp(mailMock);
    prisma = getTestPrisma();
  });

  afterAll(async () => {
    await disconnectTestPrisma();
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    mailMock.mockClear();
  });

  afterEach(async () => {
    await prisma.carePath.deleteMany({
      where: { code: { startsWith: CODE_PREFIX } },
    });
  });

  const http = () => app.getHttpServer();

  async function authFor(profileId: string, orgId: string) {
    const { user_id } = await prisma.profile.findUniqueOrThrow({
      where: { id: profileId },
      select: { user_id: true },
    });
    return bearer(
      jwt.sign(
        { userId: user_id, profileId, organizationId: orgId, type: 'access' },
        { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: '15m' },
      ),
    );
  }

  /**
   * Create a care path against seeded specialty + journey template.
   * `organizationId = null` produces a system (global) row.
   */
  async function seedCarePath(organizationId: string | null, label: string) {
    const specialty = await prisma.specialty.findFirstOrThrow();
    const journeyTemplate = await prisma.journeyTemplate.findFirstOrThrow();
    return prisma.carePath.create({
      data: {
        specialty_id: specialty.id,
        organization_id: organizationId,
        is_system: organizationId === null,
        journey_template_id: journeyTemplate.id,
        code: `${CODE_PREFIX}${label}-${randomUUID().slice(0, 8)}`,
        name: `Care Path ${label}`,
      },
    });
  }
  const seedOrgCarePath = (orgId: string, label: string) =>
    seedCarePath(orgId, label);

  it('returns system rows plus the caller org rows, but excludes another org private path', async () => {
    const a = await seedOrg(
      prisma,
      'Clinic A',
      `owner-a-${randomUUID()}@x.com`,
    );
    const b = await seedOrg(
      prisma,
      'Clinic B',
      `owner-b-${randomUUID()}@x.com`,
    );
    const system = await seedCarePath(null, 'SYS');
    const mine = await seedOrgCarePath(a.org.id, 'A');
    const foreign = await seedOrgCarePath(b.org.id, 'B');
    const auth = await authFor(a.ownerProfileId, a.org.id);

    const res = await auth(request(http()).get('/v1/care-paths')).expect(200);
    const rows: Array<{ id: string; organization_id: string | null }> =
      res.body.data;
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(mine.id);
    // System (null-org) rows are returned to every org.
    expect(ids).toContain(system.id);
    // Another org's private care path is excluded.
    expect(ids).not.toContain(foreign.id);
  });

  it('resolves :id and :id/episodes for an accessible (own) care path', async () => {
    const a = await seedOrg(prisma, 'Clinic A', `owner-${randomUUID()}@x.com`);
    const mine = await seedOrgCarePath(a.org.id, 'OWN');
    const auth = await authFor(a.ownerProfileId, a.org.id);

    const one = await auth(
      request(http()).get(`/v1/care-paths/${mine.id}`),
    ).expect(200);
    expect(one.body.data.id).toBe(mine.id);
    expect(Array.isArray(one.body.data.history_section_codes)).toBe(true);

    await auth(
      request(http()).get(`/v1/care-paths/${mine.id}/episodes`),
    ).expect(200);
  });

  it('404s when fetching another org private care path by id', async () => {
    const a = await seedOrg(
      prisma,
      'Clinic A',
      `owner-a-${randomUUID()}@x.com`,
    );
    const b = await seedOrg(
      prisma,
      'Clinic B',
      `owner-b-${randomUUID()}@x.com`,
    );
    const foreign = await seedOrgCarePath(b.org.id, 'FOREIGN');
    const auth = await authFor(a.ownerProfileId, a.org.id);

    await auth(request(http()).get(`/v1/care-paths/${foreign.id}`)).expect(404);
    await auth(
      request(http()).get(`/v1/care-paths/${foreign.id}/episodes`),
    ).expect(404);
  });
});
