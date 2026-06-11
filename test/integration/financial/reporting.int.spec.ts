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
  createPatient,
  loginAs,
  openDrawer,
  seedOrg,
} from '../../helpers/financial-helpers';

/**
 * Financial reporting endpoints against real Postgres. One seeded fixture —
 * an org whose OWNER issues a 1000 invoice (attributed to themselves) and
 * collects a partial 400 CASH payment — drives every report, asserting the
 * derived totals and the enriched fields (revenue-by-doctor attribution,
 * collections by_staff.staff_name, outstanding doctor_name + last_payment_date).
 */
describe('Financial — reports (integration)', () => {
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

  const num = (v: unknown) => Number(v);

  /**
   * Seed an org → patient → issued 1000 invoice (doctor = owner) → open drawer
   * → partial 400 CASH payment. Returns the auth injector and URL bases.
   */
  async function seedReportingFixture() {
    const a = await seedOrg(prisma, 'Clinic A', 'owner.a@example.com');
    const patientId = await createPatient(prisma, a.org.id, a.ownerProfileId);
    const auth = bearer(await loginAs(app, a.ownerEmail));
    const base = `/v1/organizations/${a.org.id}`;
    const reports = `${base}/financial/reports`;
    const http = app.getHttpServer();

    const { invoiceId } = await chargeAndIssue(
      app,
      base,
      auth,
      a.branch.id,
      patientId,
      a.ownerProfileId,
      { unit_price: 1000 },
    );
    await openDrawer(app, base, auth, a.branch.id);
    await auth(request(http).post(`${base}/invoices/${invoiceId}/payments`))
      .send({ amount: 400, payment_method: 'CASH' })
      .expect(201);

    return { a, auth, base, reports, invoiceId, http };
  }

  it('revenue: invoiced / collected / outstanding / count', async () => {
    const { auth, reports, http } = await seedReportingFixture();
    const res = await auth(request(http).get(`${reports}/revenue`)).expect(200);
    const d = res.body.data;
    expect(num(d.total_invoiced)).toBe(1000);
    expect(num(d.total_collected)).toBe(400);
    expect(num(d.outstanding)).toBe(600);
    expect(d.invoice_count).toBe(1);
  });

  it('revenue: branch-scoped returns the same totals for the owner', async () => {
    const { a, auth, reports, http } = await seedReportingFixture();
    const res = await auth(
      request(http).get(`${reports}/revenue`).query({ branch_id: a.branch.id }),
    ).expect(200);
    expect(num(res.body.data.total_invoiced)).toBe(1000);
    expect(num(res.body.data.total_collected)).toBe(400);
  });

  it('daily-revenue: a row for today carries invoiced + collected', async () => {
    const { auth, reports, http } = await seedReportingFixture();
    const res = await auth(
      request(http).get(`${reports}/daily-revenue`),
    ).expect(200);
    const rows = res.body.data.rows as Array<Record<string, unknown>>;
    const today = new Date().toISOString().slice(0, 10);
    const row = rows.find((r) => r.date === today);
    expect(row).toBeDefined();
    expect(num(row!.invoiced)).toBe(1000);
    expect(num(row!.collected)).toBe(400);
  });

  it('revenue-by-service: groups the consultation with its line count', async () => {
    const { auth, reports, http } = await seedReportingFixture();
    const res = await auth(
      request(http).get(`${reports}/revenue-by-service`),
    ).expect(200);
    const d = res.body.data;
    expect(d.by_service).toHaveLength(1);
    expect(d.by_service[0].service_name).toBe('Consultation');
    expect(num(d.by_service[0].total)).toBe(1000);
    expect(d.by_service[0].line_count).toBe(1);
    expect(num(d.total)).toBe(1000);
  });

  it('revenue-by-doctor: attributes to the owner, not Unassigned', async () => {
    const { a, auth, reports, http } = await seedReportingFixture();
    const res = await auth(
      request(http).get(`${reports}/revenue-by-doctor`),
    ).expect(200);
    const d = res.body.data;
    expect(d.by_doctor).toHaveLength(1);
    expect(d.by_doctor[0].profile_id).toBe(a.ownerProfileId);
    expect(d.by_doctor[0].doctor_name).toBe('Owner Clinic A');
    expect(d.by_doctor[0].doctor_name).not.toBe('Unassigned');
    expect(d.by_doctor[0].invoice_count).toBe(1);
  });

  it('payments-by-method: groups the CASH payment', async () => {
    const { auth, reports, http } = await seedReportingFixture();
    const res = await auth(
      request(http).get(`${reports}/payments-by-method`),
    ).expect(200);
    const cash = (
      res.body.data.by_method as Array<Record<string, unknown>>
    ).find((r) => r.payment_method === 'CASH');
    expect(cash).toBeDefined();
    expect(num(cash!.total)).toBe(400);
    expect(cash!.count).toBe(1);
  });

  it('ar-aging: outstanding sits in the current bucket', async () => {
    const { auth, reports, http } = await seedReportingFixture();
    const res = await auth(request(http).get(`${reports}/ar-aging`)).expect(
      200,
    );
    const d = res.body.data;
    expect(num(d.total_outstanding)).toBe(600);
    expect(num(d.buckets.current)).toBe(600);
  });

  it('collections: by_staff resolves the recorder name, not the id', async () => {
    const { a, auth, reports, http } = await seedReportingFixture();
    const res = await auth(request(http).get(`${reports}/collections`)).expect(
      200,
    );
    const d = res.body.data;
    expect(num(d.total)).toBe(400);
    const staff = (d.by_staff as Array<Record<string, unknown>>).find(
      (r) => r.profile_id === a.ownerProfileId,
    );
    expect(staff).toBeDefined();
    expect(staff!.staff_name).toBe('Owner Clinic A');
    expect(num(staff!.total)).toBe(400);
    expect(
      (d.by_method as Array<Record<string, unknown>>).some(
        (r) => r.payment_method === 'CASH',
      ),
    ).toBe(true);
  });

  it('outstanding-invoices: carries doctor_name + last_payment_date', async () => {
    const { auth, reports, http } = await seedReportingFixture();
    const res = await auth(
      request(http).get(`${reports}/outstanding-invoices`),
    ).expect(200);
    const d = res.body.data;
    expect(d.count).toBe(1);
    const inv = d.invoices[0];
    expect(inv.doctor_name).toBe('Owner Clinic A');
    expect(inv.last_payment_date).toBeTruthy();
    expect(num(inv.balance_due)).toBe(600);
    expect(inv.aging_bucket).toBe('current');
  });

  it('write-offs: zero when no charges were written off', async () => {
    const { auth, reports, http } = await seedReportingFixture();
    const res = await auth(request(http).get(`${reports}/write-offs`)).expect(
      200,
    );
    expect(num(res.body.data.total_written_off)).toBe(0);
    expect(res.body.data.count).toBe(0);
  });
});
