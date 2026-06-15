/**
 * Manual (DB-only) verification of a subscription payment.
 *
 * There is no platform-admin HTTP surface yet, so an operator verifies an
 * uploaded proof by running this script, which calls the same transactional
 * service method a future admin endpoint would. For a PLAN payment this sets
 * payment -> VERIFIED and the subscription -> ACTIVE with ends_at extended; for
 * an ADD_ON payment it grants/increments the add-on co-terminus with the
 * subscription. Both run atomically. Verify only via this method — a raw
 * `UPDATE ... SET status='VERIFIED'` marks the row but never activates/grants.
 *
 *   Verify (activates the plan or grants the add-on):
 *     npx tsx scripts/verify-subscription-payment.ts <paymentId>
 *
 *   Reject:
 *     npx tsx scripts/verify-subscription-payment.ts <paymentId> --reject "reason"
 *
 * Wires the dependency chain by hand rather than booting Nest: the DI container
 * relies on decorator metadata that esbuild/tsx does not emit, so a NestFactory
 * bootstrap fails under tsx. `verifyPayment`/`rejectPayment` only touch Prisma,
 * SubscriptionsService, and EventBus — the other constructor deps are unused
 * here and passed as null.
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { EventEmitter2 } from '@nestjs/event-emitter';

config({ path: '.env' });
config({
  path: `.env.${process.env.NODE_ENV ?? 'development'}`,
  override: true,
});

import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { EventBus } from '../src/infrastructure/messaging/event-bus.js';
import { SubscriptionsService } from '../src/core/org/subscriptions/subscriptions.service.js';
import { SubscriptionPaymentsService } from '../src/core/org/subscriptions/payments/subscription-payments.service.js';

async function main(): Promise<void> {
  const [, , paymentId, flag, reason] = process.argv;
  if (!paymentId) {
    console.error(
      'Usage: verify-subscription-payment.ts <paymentId> [--reject "reason"]',
    );
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const prisma = new PrismaService({ url: databaseUrl } as never);
  const eventBus = new EventBus(new EventEmitter2());
  const subscriptions = new SubscriptionsService(prisma);
  const payments = new SubscriptionPaymentsService(
    prisma,
    null as never, // AuthorizationService — unused by verify/reject
    subscriptions,
    null as never, // PaymentProviderFactory — unused by verify/reject
    null as never, // StorageService — unused by verify/reject
    eventBus,
  );

  try {
    if (flag === '--reject') {
      const result = await payments.rejectPayment(
        paymentId,
        reason ?? 'Rejected by operator',
      );
      console.log(`Payment ${result.id} rejected (status: ${result.status}).`);
    } else {
      const result = await payments.verifyPayment(paymentId);
      console.log(
        `Payment ${result.id} verified (status: ${result.status}). Subscription activated.`,
      );
    }
  } finally {
    await prisma.onModuleDestroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
