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
  seedReceptionist,
} from '../../helpers/financial-helpers';

const money = (v: unknown) => Number(v);

/**
 * The cash-session payment gate against real Postgres. A payment of any method
 * requires the *recording cashier's own* OPEN drawer at the invoice branch, and
 * the server resolves/attributes the session itself — a client cannot smuggle
 * another cashier's session id. Includes the per-cashier isolation and
 * cross-tenant security seams. Orgs are seeded directly (no signup HTTP flow)
 * to avoid the signup rate limiter.
 */
describe('Financial — cash-session payment gate (integration + security)', () => {
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

  const pay = (base: string, invoiceId: string) =>
    request(app.getHttpServer()).post(`${base}/invoices/${invoiceId}/payments`);
  const currentDrawer = (base: string, branchId: string) =>
    request(app.getHttpServer()).get(
      `${base}/financial/cash-sessions/current?branch_id=${branchId}`,
    );

  it('rejects recording a payment when the cashier has no open session (cash + card)', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    const base = `/v1/organizations/${a.org.id}`;
    const patientId = await createPatient(prisma, a.org.id, a.ownerProfileId);
    const { invoiceId } = await chargeAndIssue(
      app,
      base,
      auth,
      a.branch.id,
      patientId,
      a.ownerProfileId,
      { unit_price: 200 },
    );

    const cash = await auth(pay(base, invoiceId))
      .send({ amount: 100, payment_method: 'CASH' })
      .expect(400);
    expect(cash.body.error.message).toMatch(/open a cash session/i);

    await auth(pay(base, invoiceId))
      .send({ amount: 100, payment_method: 'CARD' })
      .expect(400);
  });

  it('attributes only cash to the drawer — a card payment never inflates collected', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    const base = `/v1/organizations/${a.org.id}`;
    const patientId = await createPatient(prisma, a.org.id, a.ownerProfileId);
    const { invoiceId } = await chargeAndIssue(
      app,
      base,
      auth,
      a.branch.id,
      patientId,
      a.ownerProfileId,
      { unit_price: 200 },
    );

    await openDrawer(app, base, auth, a.branch.id, 0);

    // Card payment succeeds but does not touch the physical drawer.
    await auth(pay(base, invoiceId))
      .send({ amount: 80, payment_method: 'CARD' })
      .expect(201);
    const afterCard = await auth(currentDrawer(base, a.branch.id)).expect(200);
    expect(money(afterCard.body.data.summary.collected)).toBe(0);

    // Cash payment is attributed to the drawer.
    await auth(pay(base, invoiceId))
      .send({ amount: 100, payment_method: 'CASH' })
      .expect(201);
    const afterCash = await auth(currentDrawer(base, a.branch.id)).expect(200);
    expect(money(afterCash.body.data.summary.collected)).toBe(100);
    expect(money(afterCash.body.data.summary.expected_so_far)).toBe(100);
  });

  it('isolates drawers per cashier: B cannot record into A’s open session', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const authA = bearer(await loginAs(app, a.ownerEmail));
    const base = `/v1/organizations/${a.org.id}`;
    const patientId = await createPatient(prisma, a.org.id, a.ownerProfileId);
    const { invoiceId } = await chargeAndIssue(
      app,
      base,
      authA,
      a.branch.id,
      patientId,
      a.ownerProfileId,
      { unit_price: 200 },
    );

    // A opens their own drawer.
    await openDrawer(app, base, authA, a.branch.id, 0);

    // B is a receptionist at the same branch with no drawer of their own.
    await seedReceptionist(prisma, a.org.id, a.branch.id, 'recep.b@example.com');
    const authB = bearer(await loginAs(app, 'recep.b@example.com'));

    // B passes the front-desk role gate but has no open session → rejected,
    // so B's cash can never land in A's drawer.
    const denied = await authB(pay(base, invoiceId))
      .send({ amount: 50, payment_method: 'CASH' })
      .expect(400);
    expect(denied.body.error.message).toMatch(/open a cash session/i);
  });

  it('rejects a client-supplied cash_session_id — the field is not accepted', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const authA = bearer(await loginAs(app, a.ownerEmail));
    const base = `/v1/organizations/${a.org.id}`;
    const patientId = await createPatient(prisma, a.org.id, a.ownerProfileId);
    const { invoiceId } = await chargeAndIssue(
      app,
      base,
      authA,
      a.branch.id,
      patientId,
      a.ownerProfileId,
      { unit_price: 200 },
    );
    const aSessionId = await openDrawer(app, base, authA, a.branch.id, 0);

    await seedReceptionist(prisma, a.org.id, a.branch.id, 'recep.b@example.com');
    const authB = bearer(await loginAs(app, 'recep.b@example.com'));

    // cash_session_id is not an accepted payload field (the server derives it),
    // so an attempt to smuggle A's session id is rejected by validation.
    await authB(pay(base, invoiceId))
      .send({
        amount: 50,
        payment_method: 'CASH',
        cash_session_id: aSessionId,
      })
      .expect(400);

    // A's drawer must be untouched by B's attempt.
    const aCurrent = await authA(currentDrawer(base, a.branch.id)).expect(200);
    expect(money(aCurrent.body.data.summary.collected)).toBe(0);
  });

  it('denies an OWNER of another org from recording on this org’s invoice', async () => {
    const a = await seedOrg(prisma, 'Org A', 'owner.a@example.com');
    const authA = bearer(await loginAs(app, a.ownerEmail));
    const baseA = `/v1/organizations/${a.org.id}`;
    const patientId = await createPatient(prisma, a.org.id, a.ownerProfileId);
    const { invoiceId } = await chargeAndIssue(
      app,
      baseA,
      authA,
      a.branch.id,
      patientId,
      a.ownerProfileId,
      { unit_price: 200 },
    );

    const b = await seedOrg(prisma, 'Org B', 'owner.b@example.com');
    const authB = bearer(await loginAs(app, b.ownerEmail));
    const denied = (res: request.Response) =>
      [400, 403, 404].includes(res.status);

    await authB(pay(baseA, invoiceId))
      .send({ amount: 50, payment_method: 'CASH' })
      .expect(denied);
  });
});
