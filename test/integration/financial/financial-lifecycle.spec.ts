import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { createTestApp } from '../../helpers/app-factory';
import { cleanDatabase } from '../../helpers/db-cleaner';
import {
  disconnectTestPrisma,
  getTestPrisma,
} from '../../helpers/prisma-test-client';

const PASSWORD = 'Password1!';
const money = (v: unknown) => Number(v);

/**
 * Cross-module financial RCM lifecycle against real Postgres: charge → invoice
 * (from-charges, % discount) → issue → partial/full payment → auto-issued
 * receipt → refund + void → cash session (variance) → reports. Plus the
 * cross-tenant seam: an OWNER of one org must not act on another org's billing.
 */
describe('Financial RCM — lifecycle + cross-tenant (integration)', () => {
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

  // ---------- helpers ----------

  async function seedOrg(name: string, ownerEmail: string) {
    const org = await prisma.organization.create({ data: { name } });
    const branch = await prisma.branch.create({
      data: {
        organization_id: org.id,
        name: 'Main',
        address: '1 St',
        city: 'Cairo',
        governorate: 'Cairo',
        is_main: true,
      },
    });
    await prisma.subscription.create({
      data: {
        organization_id: org.id,
        subscription_plan_id: (
          await prisma.subscriptionPlan.findFirstOrThrow({
            where: { plan: 'free_trial' },
          })
        ).id,
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });
    const user = await prisma.user.create({
      data: {
        first_name: 'Owner',
        last_name: name,
        email: ownerEmail,
        password_hashed: await bcrypt.hash(PASSWORD, 12),
        is_active: true,
        verified_at: new Date(),
        registration_status: 'ACTIVE',
        onboarding_completed: true,
      },
    });
    const ownerRole = await prisma.role.findFirstOrThrow({
      where: { code: 'OWNER' },
    });
    const profile = await prisma.profile.create({
      data: {
        user_id: user.id,
        organization_id: org.id,
        engagement_type: 'FULL_TIME',
        roles: { create: [{ role_id: ownerRole.id }] },
      },
    });
    return { org, branch, ownerProfileId: profile.id, ownerEmail };
  }

  async function createPatient(organizationId: string, createdById: string) {
    const patient = await prisma.patient.create({
      data: {
        national_id: `nat-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        full_name: 'Jane Doe',
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

  async function seedReceptionist(
    organizationId: string,
    branchId: string,
    email: string,
  ): Promise<string> {
    const user = await prisma.user.create({
      data: {
        first_name: 'Recep',
        last_name: 'Tion',
        email,
        password_hashed: await bcrypt.hash(PASSWORD, 12),
        is_active: true,
        verified_at: new Date(),
        registration_status: 'ACTIVE',
        onboarding_completed: true,
      },
    });
    const staffRole = await prisma.role.findFirstOrThrow({
      where: { code: 'STAFF' },
    });
    const receptionist = await prisma.jobFunction.findFirstOrThrow({
      where: { code: 'RECEPTIONIST' },
    });
    const profile = await prisma.profile.create({
      data: {
        user_id: user.id,
        organization_id: organizationId,
        engagement_type: 'FULL_TIME',
        roles: { create: [{ role_id: staffRole.id }] },
        job_functions: { create: [{ job_function_id: receptionist.id }] },
        branches: {
          create: [{ branch_id: branchId, organization_id: organizationId }],
        },
      },
    });
    return profile.id;
  }

  async function loginAs(email: string): Promise<string> {
    const http = app.getHttpServer();
    const login = await request(http)
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const profile = login.body.data.profiles[0];
    const tokens = await request(http)
      .post('/v1/auth/profiles/select')
      .send({
        selection_token: login.body.data.selection_token,
        profile_id: profile.profile_id,
        branch_id: profile.branches[0]?.branch_id,
      })
      .expect(200);
    return tokens.body.data.access_token as string;
  }

  const bearer =
    (token: string) =>
    (req: request.Test): request.Test =>
      req.set('Authorization', `Bearer ${token}`);

  async function eventually<T>(
    fn: () => Promise<T>,
    tries = 20,
    delayMs = 150,
  ): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw lastErr;
  }

  /** Capture a charge and assemble + issue an invoice for it. Returns ids. */
  async function chargeAndIssue(
    base: string,
    auth: (r: request.Test) => request.Test,
    branchId: string,
    patientId: string,
    profileId: string,
    opts: { unit_price: number; discount?: number } = { unit_price: 200 },
  ) {
    const http = app.getHttpServer();
    const svc = await auth(
      request(http).post(`${base}/financial/catalog/services`),
    )
      .send({
        code: `CONSULT-${Math.floor(Math.random() * 1e6)}`,
        name: 'Consultation',
        service_type: 'CONSULTATION',
      })
      .expect(201);
    await auth(request(http).post(`${base}/financial/charges`))
      .send({
        branch_id: branchId,
        patient_id: patientId,
        profile_id: profileId,
        service_id: svc.body.data.id,
        description: 'Consultation',
        quantity: 1,
        unit_price: opts.unit_price,
      })
      .expect(201);
    const inv = await auth(request(http).post(`${base}/invoices/from-charges`))
      .send({
        branch_id: branchId,
        patient_id: patientId,
        ...(opts.discount !== undefined && {
          discount_type: 'PERCENTAGE',
          discount_value: opts.discount,
        }),
      })
      .expect(201);
    const invoiceId = inv.body.data.id as string;
    await auth(
      request(http).post(`${base}/invoices/${invoiceId}/issue`),
    ).expect(201);
    return { invoiceId, serviceId: svc.body.data.id, invoice: inv.body.data };
  }

  /** Open the caller's cash drawer at a branch so payments can be recorded. */
  async function openDrawer(
    base: string,
    auth: (r: request.Test) => request.Test,
    branchId: string,
    openingFloat = 0,
  ): Promise<string> {
    const open = await auth(
      request(app.getHttpServer()).post(`${base}/financial/cash-sessions`),
    )
      .send({ branch_id: branchId, opening_float: openingFloat })
      .expect(201);
    return open.body.data.id as string;
  }

  // ---------- tests ----------

  it('drives the full charge → invoice → pay → receipt → refund lifecycle', async () => {
    const a = await seedOrg('Org A', 'owner.a@example.com');
    const patientId = await createPatient(a.org.id, a.ownerProfileId);
    const auth = bearer(await loginAs(a.ownerEmail));
    const http = app.getHttpServer();
    const base = `/v1/organizations/${a.org.id}`;

    const { invoiceId, invoice } = await chargeAndIssue(
      base,
      auth,
      a.branch.id,
      patientId,
      a.ownerProfileId,
      { unit_price: 200, discount: 10 },
    );
    // 200 − 10% = 180 billed, balance starts at full total.
    expect(money(invoice.discount_amount)).toBe(20);
    expect(money(invoice.total_amount)).toBe(180);
    expect(money(invoice.balance_due)).toBe(180);

    // recording a payment requires an open drawer at the branch
    await openDrawer(base, auth, a.branch.id);

    // partial payment 100 → PARTIALLY_PAID, balance 80, returns { payment, invoice }
    const pay1 = await auth(
      request(http).post(`${base}/invoices/${invoiceId}/payments`),
    )
      .send({ amount: 100, payment_method: 'CASH' })
      .expect(201);
    expect(pay1.body.data.invoice.status).toBe('PARTIALLY_PAID');
    expect(money(pay1.body.data.invoice.balance_due)).toBe(80);

    // receipt auto-issued via the payment.recorded listener
    const receipts = await eventually(async () => {
      const r = await auth(
        request(http).get(`${base}/receipts?invoice_id=${invoiceId}`),
      ).expect(200);
      if (!r.body.data.length) throw new Error('receipt not issued yet');
      return r.body.data as Array<{ receipt_number: string }>;
    });
    expect(receipts[0].receipt_number).toMatch(/^RCP-/);

    // remainder 80 → PAID, balance 0
    const pay2 = await auth(
      request(http).post(`${base}/invoices/${invoiceId}/payments`),
    )
      .send({ amount: 80, payment_method: 'CARD' })
      .expect(201);
    expect(pay2.body.data.invoice.status).toBe('PAID');
    expect(money(pay2.body.data.invoice.balance_due)).toBe(0);

    // overpayment rejected
    await auth(request(http).post(`${base}/invoices/${invoiceId}/payments`))
      .send({ amount: 10, payment_method: 'CASH' })
      .expect(400);

    // refund 50 against the first payment → balance restored to 50
    const refund = await auth(request(http).post(`${base}/refunds`))
      .send({
        payment_id: pay1.body.data.payment.id,
        amount: 50,
        reason: 'overcharge correction',
      })
      .expect(201);
    const afterRefund = await auth(
      request(http).get(`${base}/invoices/${invoiceId}`),
    ).expect(200);
    expect(money(afterRefund.body.data.balance_due)).toBe(50);

    // void the refund → balance back to 0
    await auth(
      request(http).post(`${base}/refunds/${refund.body.data.id}/void`),
    ).expect(201);
    const afterVoid = await auth(
      request(http).get(`${base}/invoices/${invoiceId}`),
    ).expect(200);
    expect(money(afterVoid.body.data.balance_due)).toBe(0);
    expect(afterVoid.body.data.status).toBe('PAID');

    // reports reflect the billed service revenue
    const byService = await auth(
      request(http).get(`${base}/financial/reports/revenue-by-service`),
    ).expect(200);
    const total = money(byService.body.data.total);
    expect(total).toBeGreaterThan(0);
  });

  it('runs a cash session: open → linked cash payment → variance on close; rejects a second open/close', async () => {
    const a = await seedOrg('Org A', 'owner.a@example.com');
    const patientId = await createPatient(a.org.id, a.ownerProfileId);
    const auth = bearer(await loginAs(a.ownerEmail));
    const http = app.getHttpServer();
    const base = `/v1/organizations/${a.org.id}`;

    const { invoiceId } = await chargeAndIssue(
      base,
      auth,
      a.branch.id,
      patientId,
      a.ownerProfileId,
      { unit_price: 200 },
    );

    // open a drawer with a 500 float
    const open = await auth(
      request(http).post(`${base}/financial/cash-sessions`),
    )
      .send({ branch_id: a.branch.id, opening_float: 500 })
      .expect(201);
    const sessionId = open.body.data.id as string;
    expect(money(open.body.data.summary.expected_so_far)).toBe(500);

    // a second open at the same branch is rejected
    await auth(request(http).post(`${base}/financial/cash-sessions`))
      .send({ branch_id: a.branch.id, opening_float: 100 })
      .expect(409);

    // record a 200 CASH payment linked to the session
    await auth(request(http).post(`${base}/invoices/${invoiceId}/payments`))
      .send({
        amount: 200,
        payment_method: 'CASH',
        cash_session_id: sessionId,
      })
      .expect(201);

    // current drawer reflects float + collected
    const current = await auth(
      request(http).get(
        `${base}/financial/cash-sessions/current?branch_id=${a.branch.id}`,
      ),
    ).expect(200);
    expect(money(current.body.data.summary.collected)).toBe(200);
    expect(money(current.body.data.summary.expected_so_far)).toBe(700);

    // close with the exact count → variance 0
    const close = await auth(
      request(http).post(`${base}/financial/cash-sessions/${sessionId}/close`),
    )
      .send({ counted_amount: 700 })
      .expect(201);
    expect(close.body.data.status).toBe('CLOSED');
    expect(money(close.body.data.variance)).toBe(0);

    // closing an already-closed session is rejected
    await auth(
      request(http).post(`${base}/financial/cash-sessions/${sessionId}/close`),
    )
      .send({ counted_amount: 700 })
      .expect(400);
  });

  it('denies an OWNER of one org any billing action on another org', async () => {
    const a = await seedOrg('Org A', 'owner.a@example.com');
    const b = await seedOrg('Org B', 'owner.b@example.com');
    const patientId = await createPatient(a.org.id, a.ownerProfileId);

    const authA = bearer(await loginAs(a.ownerEmail));
    const baseA = `/v1/organizations/${a.org.id}`;
    const { invoiceId } = await chargeAndIssue(
      baseA,
      authA,
      a.branch.id,
      patientId,
      a.ownerProfileId,
      { unit_price: 200 },
    );

    const authB = bearer(await loginAs(b.ownerEmail));
    const http = app.getHttpServer();
    const denied = (res: request.Response) =>
      [400, 403, 404].includes(res.status);

    // Reading A's invoice as B's OWNER → blocked.
    await authB(request(http).get(`${baseA}/invoices/${invoiceId}`)).expect(
      denied,
    );
    // Recording a payment on A's invoice → blocked (the assertIsReceptionistOrOwner fix).
    await authB(request(http).post(`${baseA}/invoices/${invoiceId}/payments`))
      .send({ amount: 50, payment_method: 'CASH' })
      .expect(denied);
    // Creating an invoice in A → blocked.
    await authB(request(http).post(`${baseA}/invoices`))
      .send({
        branch_id: a.branch.id,
        patient_id: patientId,
        items: [{ description: 'x', unit_price: 10 }],
      })
      .expect(denied);
    // Capturing a charge in A → blocked.
    await authB(request(http).post(`${baseA}/financial/charges`))
      .send({
        branch_id: a.branch.id,
        patient_id: patientId,
        profile_id: a.ownerProfileId,
        description: 'x',
        unit_price: 10,
      })
      .expect(denied);
  });

  it('notifies the branch receptionist when a doctor adds a service', async () => {
    const a = await seedOrg('Org A', 'owner.a@example.com');
    const receptionistId = await seedReceptionist(
      a.org.id,
      a.branch.id,
      'recep.a@example.com',
    );
    const patientId = await createPatient(a.org.id, a.ownerProfileId);
    const auth = bearer(await loginAs(a.ownerEmail));
    const http = app.getHttpServer();
    const base = `/v1/organizations/${a.org.id}`;

    // the owner is both captor and rendering provider -> charge source = DOCTOR
    const svc = await auth(
      request(http).post(`${base}/financial/catalog/services`),
    )
      .send({
        code: `CONSULT-${Math.floor(Math.random() * 1e6)}`,
        name: 'Consultation',
        service_type: 'CONSULTATION',
      })
      .expect(201);
    await auth(request(http).post(`${base}/financial/charges`))
      .send({
        branch_id: a.branch.id,
        patient_id: patientId,
        profile_id: a.ownerProfileId,
        service_id: svc.body.data.id,
        description: 'Consultation',
        unit_price: 200,
      })
      .expect(201);

    // the charge.captured listener asynchronously writes the reception notice
    const notification = await eventually(async () => {
      const n = await prisma.notification.findFirst({
        where: {
          profile_id: receptionistId,
          code: 'billing.service_charge_added',
        },
      });
      if (!n) throw new Error('notification not created yet');
      return n;
    });
    expect(notification.category).toBe('billing');
  });

  it('appends a later charge to a fully-paid invoice, reopening it for the balance', async () => {
    const a = await seedOrg('Org A', 'owner.a@example.com');
    const patientId = await createPatient(a.org.id, a.ownerProfileId);
    const auth = bearer(await loginAs(a.ownerEmail));
    const http = app.getHttpServer();
    const base = `/v1/organizations/${a.org.id}`;

    // First service: charge → invoice → issue → pay in full.
    const { invoiceId } = await chargeAndIssue(
      base,
      auth,
      a.branch.id,
      patientId,
      a.ownerProfileId,
      { unit_price: 200 },
    );
    await openDrawer(base, auth, a.branch.id);
    const payFull = await auth(
      request(http).post(`${base}/invoices/${invoiceId}/payments`),
    )
      .send({ amount: 200, payment_method: 'CASH' })
      .expect(201);
    expect(payFull.body.data.invoice.status).toBe('PAID');

    // A second service is rendered later → a fresh PENDING charge.
    const svc2 = await auth(
      request(http).post(`${base}/financial/catalog/services`),
    )
      .send({
        code: `PROC-${Math.floor(Math.random() * 1e6)}`,
        name: 'Procedure',
        service_type: 'CONSULTATION',
      })
      .expect(201);
    const charge2 = await auth(request(http).post(`${base}/financial/charges`))
      .send({
        branch_id: a.branch.id,
        patient_id: patientId,
        profile_id: a.ownerProfileId,
        service_id: svc2.body.data.id,
        description: 'Procedure',
        unit_price: 150,
      })
      .expect(201);

    // Append it to the already-paid invoice → reopens to PARTIALLY_PAID.
    const appended = await auth(
      request(http).post(`${base}/invoices/${invoiceId}/append-charges`),
    )
      .send({})
      .expect(201);
    expect(money(appended.body.data.total_amount)).toBe(350);
    expect(money(appended.body.data.balance_due)).toBe(150);
    expect(appended.body.data.status).toBe('PARTIALLY_PAID');

    // The appended charge is now INVOICED.
    const c2 = await prisma.charge.findUnique({
      where: { id: charge2.body.data.id },
    });
    expect(c2?.status).toBe('INVOICED');

    // Collect the balance → PAID.
    const pay2 = await auth(
      request(http).post(`${base}/invoices/${invoiceId}/payments`),
    )
      .send({ amount: 150, payment_method: 'CASH' })
      .expect(201);
    expect(pay2.body.data.invoice.status).toBe('PAID');

    // Nothing left to append → 400.
    await auth(
      request(http).post(`${base}/invoices/${invoiceId}/append-charges`),
    )
      .send({})
      .expect(400);
  });

  it('lists a same-day invoice when filtered by today (inclusive date_to)', async () => {
    const a = await seedOrg('Org A', 'owner.a@example.com');
    const patientId = await createPatient(a.org.id, a.ownerProfileId);
    const auth = bearer(await loginAs(a.ownerEmail));
    const http = app.getHttpServer();
    const base = `/v1/organizations/${a.org.id}`;

    const { invoiceId } = await chargeAndIssue(
      base,
      auth,
      a.branch.id,
      patientId,
      a.ownerProfileId,
      { unit_price: 200 },
    );

    // The reception billing panel filters by date_from = date_to = today; the
    // invoice was created moments ago, so an inclusive upper bound must return it.
    const today = new Date().toISOString().split('T')[0];
    const list = await auth(
      request(http).get(
        `${base}/invoices?branch_id=${a.branch.id}&date_from=${today}&date_to=${today}`,
      ),
    ).expect(200);
    const ids = (list.body.data as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toContain(invoiceId);
  });

  it('collects a procedure priced up front in installments until PAID', async () => {
    const a = await seedOrg('Org A', 'owner.a@example.com');
    const patientId = await createPatient(a.org.id, a.ownerProfileId);
    const auth = bearer(await loginAs(a.ownerEmail));
    const http = app.getHttpServer();
    const base = `/v1/organizations/${a.org.id}`;

    // The whole procedure (e.g. a root canal) is priced up front as one charge.
    const { invoiceId, invoice } = await chargeAndIssue(
      base,
      auth,
      a.branch.id,
      patientId,
      a.ownerProfileId,
      { unit_price: 5000 },
    );
    expect(money(invoice.total_amount)).toBe(5000);

    await openDrawer(base, auth, a.branch.id);

    // First installment.
    const pay1 = await auth(
      request(http).post(`${base}/invoices/${invoiceId}/payments`),
    )
      .send({ amount: 2000, payment_method: 'CASH' })
      .expect(201);
    expect(pay1.body.data.invoice.status).toBe('PARTIALLY_PAID');
    expect(money(pay1.body.data.invoice.balance_due)).toBe(3000);

    // Second installment.
    const pay2 = await auth(
      request(http).post(`${base}/invoices/${invoiceId}/payments`),
    )
      .send({ amount: 1500, payment_method: 'CASH' })
      .expect(201);
    expect(pay2.body.data.invoice.status).toBe('PARTIALLY_PAID');
    expect(money(pay2.body.data.invoice.balance_due)).toBe(1500);

    // Final installment settles the case.
    const pay3 = await auth(
      request(http).post(`${base}/invoices/${invoiceId}/payments`),
    )
      .send({ amount: 1500, payment_method: 'CARD' })
      .expect(201);
    expect(pay3.body.data.invoice.status).toBe('PAID');
    expect(money(pay3.body.data.invoice.balance_due)).toBe(0);
  });

  it('rejects appending charges to a voided invoice', async () => {
    const a = await seedOrg('Org A', 'owner.a@example.com');
    const patientId = await createPatient(a.org.id, a.ownerProfileId);
    const auth = bearer(await loginAs(a.ownerEmail));
    const http = app.getHttpServer();
    const base = `/v1/organizations/${a.org.id}`;

    const { invoiceId } = await chargeAndIssue(
      base,
      auth,
      a.branch.id,
      patientId,
      a.ownerProfileId,
      { unit_price: 200 },
    );
    await auth(request(http).post(`${base}/invoices/${invoiceId}/void`)).expect(
      201,
    );

    // A new PENDING charge exists, but the invoice is VOID → append blocked.
    const svc = await auth(
      request(http).post(`${base}/financial/catalog/services`),
    )
      .send({
        code: `EXTRA-${Math.floor(Math.random() * 1e6)}`,
        name: 'Extra',
        service_type: 'CONSULTATION',
      })
      .expect(201);
    await auth(request(http).post(`${base}/financial/charges`))
      .send({
        branch_id: a.branch.id,
        patient_id: patientId,
        profile_id: a.ownerProfileId,
        service_id: svc.body.data.id,
        description: 'Extra',
        unit_price: 50,
      })
      .expect(201);

    await auth(
      request(http).post(`${base}/invoices/${invoiceId}/append-charges`),
    )
      .send({})
      .expect(400);
  });
});
