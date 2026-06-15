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
import { loginAs, seedOrg } from '../../helpers/financial-helpers';
import { SubscriptionPaymentsService } from '../../../src/core/org/subscriptions/payments/subscription-payments.service';

/**
 * End-to-end subscription payment flow against real Postgres:
 *   owner picks a plan -> creates a payment -> uploads + confirms proof
 *   (AWAITING_VERIFICATION) -> DB-only verify activates the subscription.
 * Plus the subscription guard: an EXPIRED org is blocked from writes but can
 * still read and reach the billing surface. R2 is stubbed (no real network).
 */
describe('Subscriptions — payment flow + write gate (integration)', () => {
  let app: INestApplication;
  let mailMock: jest.Mock;
  let prisma: PrismaClient;

  const storageMock = {
    assertAllowedContentType: jest.fn(),
    assertWithinSizeLimit: jest.fn(),
    extensionFor: jest.fn(() => 'png'),
    createPresignedUploadUrl: jest
      .fn()
      .mockResolvedValue({ url: 'https://r2.test/put', expiresIn: 300 }),
    headObject: jest
      .fn()
      .mockResolvedValue({ contentType: 'image/png', contentLength: 1024 }),
    createPresignedDownloadUrl: jest
      .fn()
      .mockResolvedValue('https://r2.test/get'),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    mailMock = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp(mailMock, storageMock);
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

  const http = () => app.getHttpServer();

  it('lists plans with prices (public)', async () => {
    const res = await request(http()).get('/v1/subscription-plans').expect(200);
    const center = res.body.data.find(
      (p: { plan: string }) => p.plan === 'center',
    );
    expect(center).toBeDefined();
    const yearly = center.prices.find(
      (pr: { billing_interval: string }) => pr.billing_interval === 'YEARLY',
    );
    expect(yearly).toBeDefined();
    expect(Number(yearly.price)).toBeGreaterThan(0);
  });

  it('runs create -> proof -> verify and activates the subscription', async () => {
    const seeded = await seedOrg(prisma, 'PayFlow', 'payflow-owner@test.com');
    const token = await loginAs(app, seeded.ownerEmail);
    const auth = bearer(token);
    const base = `/v1/organizations/${seeded.org.id}/subscription`;

    // 1. Create the payment for the "center" plan via InstaPay.
    const created = await auth(request(http()).post(`${base}/payments`))
      .send({ plan: 'center', provider: 'INSTAPAY' })
      .expect(201);
    const payment = created.body.data.payment;
    expect(payment.status).toBe('PENDING');
    expect(created.body.data.requires_proof).toBe(true);
    expect(created.body.data.instructions.reference).toBe(payment.id);

    // 2. Get a presigned upload URL, then confirm the proof.
    const uploaded = await auth(
      request(http()).post(`${base}/payments/${payment.id}/proof/upload-url`),
    )
      .send({ content_type: 'image/png', size_bytes: 1024 })
      .expect(201);
    expect(uploaded.body.data.key).toContain(
      `subscription-payments/${payment.id}/proofs/`,
    );

    const confirmed = await auth(
      request(http()).post(`${base}/payments/${payment.id}/proof`),
    )
      .send({ key: uploaded.body.data.key })
      .expect(201);
    expect(confirmed.body.data.status).toBe('AWAITING_VERIFICATION');
    expect(confirmed.body.data.proofs).toHaveLength(1);

    // 3. DB-only verification (the script's service method) activates the sub.
    await app.get(SubscriptionPaymentsService).verifyPayment(payment.id);

    const current = await auth(request(http()).get(base)).expect(200);
    expect(current.body.data.status).toBe('ACTIVE');
    expect(current.body.data.plan.plan).toBe('center');
    expect(current.body.data.effective_limits.max_branches).toBe(1);
    const endsAt = new Date(current.body.data.ends_at).getTime();
    expect(endsAt).toBeGreaterThan(Date.now() + 300 * 24 * 60 * 60 * 1000);
  });

  it('buys a branch add-on (prorated) and raises the effective branch limit', async () => {
    const seeded = await seedOrg(prisma, 'AddOnFlow', 'addon-owner@test.com');
    const token = await loginAs(app, seeded.ownerEmail);
    const auth = bearer(token);
    const base = `/v1/organizations/${seeded.org.id}/subscription`;

    // Activate the base "center" plan first (add-ons require an active sub).
    const planPay = await auth(request(http()).post(`${base}/payments`))
      .send({ plan: 'center', provider: 'INSTAPAY' })
      .expect(201);
    const planProof = await auth(
      request(http()).post(
        `${base}/payments/${planPay.body.data.payment.id}/proof/upload-url`,
      ),
    )
      .send({ content_type: 'image/png', size_bytes: 1024 })
      .expect(201);
    await auth(
      request(http()).post(
        `${base}/payments/${planPay.body.data.payment.id}/proof`,
      ),
    )
      .send({ key: planProof.body.data.key })
      .expect(201);
    await app
      .get(SubscriptionPaymentsService)
      .verifyPayment(planPay.body.data.payment.id);

    // The add-on catalog should now expose center-tier add-ons.
    const addOns = await auth(request(http()).get(`${base}/add-ons`)).expect(
      200,
    );
    const branchAddOn = addOns.body.data.find(
      (a: { code: string }) => a.code === 'center_extra_branch',
    );
    expect(branchAddOn).toBeDefined();
    expect(branchAddOn.delta_branches).toBe(1);

    // Buy it (prorated to the remaining term).
    const addOnPay = await auth(request(http()).post(`${base}/payments`))
      .send({
        plan: 'center',
        provider: 'INSTAPAY',
        add_on_code: 'center_extra_branch',
      })
      .expect(201);
    expect(addOnPay.body.data.payment.purpose).toBe('ADD_ON');
    expect(Number(addOnPay.body.data.payment.amount)).toBeGreaterThan(0);

    const addOnProof = await auth(
      request(http()).post(
        `${base}/payments/${addOnPay.body.data.payment.id}/proof/upload-url`,
      ),
    )
      .send({ content_type: 'image/png', size_bytes: 1024 })
      .expect(201);
    await auth(
      request(http()).post(
        `${base}/payments/${addOnPay.body.data.payment.id}/proof`,
      ),
    )
      .send({ key: addOnProof.body.data.key })
      .expect(201);
    await app
      .get(SubscriptionPaymentsService)
      .verifyPayment(addOnPay.body.data.payment.id);

    // Effective branch limit rises base(1) + add-on(1) = 2, with the add-on listed.
    const current = await auth(request(http()).get(base)).expect(200);
    expect(current.body.data.effective_limits.max_branches).toBe(2);
    expect(current.body.data.effective_limits.max_staff).toBe(15); // 10 + 5 bundled
    expect(current.body.data.add_ons).toHaveLength(1);
    expect(current.body.data.add_ons[0].code).toBe('center_extra_branch');
  });

  it('blocks writes for an EXPIRED org but still allows reads', async () => {
    const seeded = await seedOrg(prisma, 'Lapsed', 'lapsed-owner@test.com');
    await prisma.subscription.updateMany({
      where: { organization_id: seeded.org.id },
      data: { status: 'EXPIRED', ends_at: new Date(Date.now() - 1000) },
    });
    const token = await loginAs(app, seeded.ownerEmail);
    const auth = bearer(token);
    const catalog = `/v1/organizations/${seeded.org.id}/financial/catalog/categories`;

    // Write is blocked with SUBSCRIPTION_EXPIRED.
    const blocked = await auth(request(http()).post(catalog))
      .send({ code: 'CAT1', name: 'Cat' })
      .expect(403);
    expect(blocked.body.error.code).toBe('SUBSCRIPTION_EXPIRED');

    // Reads still work.
    await auth(request(http()).get(catalog)).expect(200);

    // The billing surface stays reachable so the owner can pay to renew.
    await auth(
      request(http()).get(`/v1/organizations/${seeded.org.id}/subscription`),
    ).expect(200);
  });
});
