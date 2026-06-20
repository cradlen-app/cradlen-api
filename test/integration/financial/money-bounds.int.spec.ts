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
  createPatient,
  loginAs,
  seedOrg,
} from '../../helpers/financial-helpers';
import { MAX_MONETARY_AMOUNT } from '../../../src/core/financial/shared/money/money';

/**
 * Monetary input bounds. Every money field accepted over the API is
 * `Decimal(10,2)` in the schema (hard ceiling 99,999,999.99), so an unbounded
 * amount >= 1e8 used to overflow the column and surface as an unhandled 500 —
 * and any value below that froze an absurd charge onto the record. The DTOs now
 * cap each money input at MAX_MONETARY_AMOUNT, turning oversized input into a
 * clean 400 at the validation boundary. Positive controls prove ordinary
 * amounts still pass.
 */
describe('Financial — monetary input bounds (integration + security)', () => {
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

  const OVER_MAX = 10_000_000; // > MAX_MONETARY_AMOUNT (9,999,999.99)

  async function setup() {
    const a = await seedOrg(prisma, 'Bounds Org', 'owner.bounds@example.com');
    const auth = bearer(await loginAs(app, a.ownerEmail));
    const base = `/v1/organizations/${a.org.id}`;
    const patientId = await createPatient(prisma, a.org.id, a.ownerProfileId);
    return { a, auth, base, patientId };
  }

  const captureCharge = (
    base: string,
    branchId: string,
    patientId: string,
    profileId: string,
    unitPrice: number,
  ) =>
    request(app.getHttpServer()).post(`${base}/financial/charges`).send({
      branch_id: branchId,
      patient_id: patientId,
      profile_id: profileId,
      description: 'Consultation',
      quantity: 1,
      unit_price: unitPrice,
    });

  it('rejects a charge whose unit_price exceeds the monetary ceiling (400, not 500)', async () => {
    const { a, auth, base, patientId } = await setup();
    await auth(
      captureCharge(base, a.branch.id, patientId, a.ownerProfileId, OVER_MAX),
    ).expect(400);
  });

  it('accepts a charge with an ordinary unit_price (positive control)', async () => {
    const { a, auth, base, patientId } = await setup();
    await auth(
      captureCharge(base, a.branch.id, patientId, a.ownerProfileId, 200),
    ).expect(201);
  });

  it('accepts a charge priced exactly at the ceiling, rejects one cent over', async () => {
    const { a, auth, base, patientId } = await setup();
    await auth(
      captureCharge(
        base,
        a.branch.id,
        patientId,
        a.ownerProfileId,
        MAX_MONETARY_AMOUNT,
      ),
    ).expect(201);
    await auth(
      captureCharge(
        base,
        a.branch.id,
        patientId,
        a.ownerProfileId,
        MAX_MONETARY_AMOUNT + 0.01,
      ),
    ).expect(400);
  });

  it('rejects recording a payment whose amount exceeds the monetary ceiling (400)', async () => {
    const { a, auth, base, patientId } = await setup();
    // A real issued invoice so the path resolves to the payment handler; DTO
    // validation rejects the oversized amount before any balance logic runs.
    const svc = await auth(
      request(app.getHttpServer()).post(`${base}/financial/catalog/services`),
    )
      .send({ code: 'C1', name: 'Consult', service_type: 'CONSULTATION' })
      .expect(201);
    await auth(
      captureCharge(base, a.branch.id, patientId, a.ownerProfileId, 200),
    ).expect(201);
    const inv = await auth(
      request(app.getHttpServer()).post(`${base}/invoices/from-charges`),
    )
      .send({ branch_id: a.branch.id, patient_id: patientId })
      .expect(201);
    const invoiceId = inv.body.data.id as string;
    void svc;
    await auth(
      request(app.getHttpServer()).post(`${base}/invoices/${invoiceId}/issue`),
    ).expect(201);

    await auth(
      request(app.getHttpServer()).post(
        `${base}/invoices/${invoiceId}/payments`,
      ),
    )
      .send({ amount: OVER_MAX, payment_method: 'CASH' })
      .expect(400);
  });

  it('rejects creating an invoice with an item priced over the ceiling (400)', async () => {
    const { a, auth, base, patientId } = await setup();
    await auth(request(app.getHttpServer()).post(`${base}/invoices`))
      .send({
        branch_id: a.branch.id,
        patient_id: patientId,
        items: [{ description: 'x', unit_price: OVER_MAX }],
      })
      .expect(400);
  });
});
