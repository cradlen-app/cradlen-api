import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';
import { bearer } from '../../helpers/auth-helpers';
import {
  chargeAndIssue,
  loginAs,
  seedOrg,
} from '../../helpers/financial-helpers';

/**
 * The invoice list endpoint against real Postgres: server-side pagination
 * (page/limit + meta), the embedded `patient { id, full_name }` relation, and
 * free-text `search` across invoice_number and patient name. Plus the security
 * seams — cross-tenant denial, org-scoped isolation under search, and query
 * validation. Orgs are seeded directly (no signup HTTP flow) to dodge the
 * signup rate limiter.
 */
describe('Financial — invoice list: search + pagination (integration + security)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let prisma: PrismaClient;

  beforeAll(async () => {
    mailMock = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp(mailMock);
    prisma = getTestPrisma();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestPrisma();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    mailMock.mockClear();
  });

  const list = (base: string, qs = '') =>
    request(app.getHttpServer()).get(`${base}/invoices${qs}`);

  /** Create a patient with a given name + open journey so charges can attach. */
  async function seedNamedPatient(
    organizationId: string,
    createdById: string,
    fullName: string,
  ): Promise<string> {
    const patient = await prisma.patient.create({
      data: {
        national_id: `nat-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        full_name: fullName,
        date_of_birth: new Date('1990-01-01'),
        phone_number: '01000000000',
        address: '10 Nile St',
      },
    });
    const template = await prisma.journeyTemplate.findFirstOrThrow();
    await prisma.patientJourney.create({
      data: {
        patient_id: patient.id,
        organization_id: organizationId,
        journey_template_id: template.id,
        created_by_id: createdById,
      },
    });
    return patient.id;
  }

  // ---------- functional ----------

  it('paginates with correct meta and no row overlap across pages', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    const base = `/v1/organizations/${a.org.id}`;

    for (const name of ['Alice Adams', 'Bob Brown', 'Carol Clark']) {
      const pid = await seedNamedPatient(a.org.id, a.ownerProfileId, name);
      await chargeAndIssue(
        app,
        base,
        auth,
        a.branch.id,
        pid,
        a.ownerProfileId,
        {
          unit_price: 100,
        },
      );
    }

    const page1 = await auth(list(base, '?limit=2&page=1')).expect(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta).toMatchObject({
      total: 3,
      page: 1,
      limit: 2,
      totalPages: 2,
    });

    const page2 = await auth(list(base, '?limit=2&page=2')).expect(200);
    expect(page2.body.data).toHaveLength(1);

    const page1Ids = page1.body.data.map((i: { id: string }) => i.id);
    expect(page1Ids).not.toContain(page2.body.data[0].id);
  });

  it('embeds patient { id, full_name } on each list row', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    const base = `/v1/organizations/${a.org.id}`;
    const pid = await seedNamedPatient(a.org.id, a.ownerProfileId, 'Dina Diab');
    await chargeAndIssue(app, base, auth, a.branch.id, pid, a.ownerProfileId, {
      unit_price: 100,
    });

    const res = await auth(list(base)).expect(200);
    expect(res.body.data[0].patient).toMatchObject({
      id: pid,
      full_name: 'Dina Diab',
    });
  });

  it('searches by partial invoice number', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    const base = `/v1/organizations/${a.org.id}`;
    const pid = await seedNamedPatient(a.org.id, a.ownerProfileId, 'Eve Ellis');
    await chargeAndIssue(app, base, auth, a.branch.id, pid, a.ownerProfileId, {
      unit_price: 100,
    });

    const all = await auth(list(base)).expect(200);
    const num: string = all.body.data[0].invoice_number;
    const part = num.slice(-4); // tail of e.g. INV-2026-00001

    const res = await auth(list(base, `?search=${part}`)).expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(
      res.body.data.every((i: { invoice_number: string }) =>
        i.invoice_number.includes(part),
      ),
    ).toBe(true);
  });

  it('searches by patient name, case-insensitively', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    const base = `/v1/organizations/${a.org.id}`;
    for (const name of ['Alice Adams', 'Bob Brown']) {
      const pid = await seedNamedPatient(a.org.id, a.ownerProfileId, name);
      await chargeAndIssue(
        app,
        base,
        auth,
        a.branch.id,
        pid,
        a.ownerProfileId,
        {
          unit_price: 100,
        },
      );
    }

    const res = await auth(list(base, '?search=alice')).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].patient.full_name).toBe('Alice Adams');
  });

  // ---------- security ----------

  it('denies an OWNER of another org from listing this org’s invoices', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const b = await seedOrg(prisma, 'Org B', 'owner.b@example.com');
    const authB = bearer(await loginAs(app, b.ownerEmail));
    const denied = (res: request.Response) =>
      [400, 403, 404].includes(res.status);

    await authB(list(`/v1/organizations/${a.org.id}`)).expect(denied);
  });

  it('never returns another org’s invoices even when searching by their patient name', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const authA = bearer(await loginAs(app, a.ownerEmail));
    const baseA = `/v1/organizations/${a.org.id}`;
    const pidA = await seedNamedPatient(
      a.org.id,
      a.ownerProfileId,
      'Hala Hana',
    );
    await chargeAndIssue(
      app,
      baseA,
      authA,
      a.branch.id,
      pidA,
      a.ownerProfileId,
      {
        unit_price: 100,
      },
    );

    const b = await seedOrg(prisma, 'Org B', 'owner.b@example.com');
    const authB = bearer(await loginAs(app, b.ownerEmail));
    const baseB = `/v1/organizations/${b.org.id}`;
    const pidB = await seedNamedPatient(
      b.org.id,
      b.ownerProfileId,
      'Zara Zaki',
    );
    await chargeAndIssue(
      app,
      baseB,
      authB,
      b.branch.id,
      pidB,
      b.ownerProfileId,
      {
        unit_price: 100,
      },
    );

    // Org A searches for Org B's patient name → no leakage.
    const res = await authA(list(baseA, '?search=Zara')).expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  // ---------- query validation ----------

  it('rejects a limit over the max (101)', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    await auth(list(`/v1/organizations/${a.org.id}`, '?limit=101')).expect(400);
  });

  it('rejects an overlong search string (>100 chars)', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    await auth(
      list(`/v1/organizations/${a.org.id}`, `?search=${'x'.repeat(101)}`),
    ).expect(400);
  });

  it('rejects an invalid status enum', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    await auth(list(`/v1/organizations/${a.org.id}`, '?status=BOGUS')).expect(
      400,
    );
  });
});
