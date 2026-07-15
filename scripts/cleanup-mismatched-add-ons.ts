/**
 * One-off data hygiene: cancel owned add-ons that belong to a different plan
 * than the subscription's current plan.
 *
 * Add-ons are plan-scoped — an add-on bought for one plan does not transfer to
 * another. `activate()` now cancels mismatched add-ons on every plan change,
 * but rows granted before that fix may still be ACTIVE while pointing at the
 * old plan's catalog. The read paths defensively ignore them, so timing is not
 * critical; this script just makes the DB reflect reality.
 *
 *   Dry-run (default — prints the rows it would cancel):
 *     npx tsx scripts/cleanup-mismatched-add-ons.ts
 *
 *   Apply:
 *     npx tsx scripts/cleanup-mismatched-add-ons.ts --apply
 */
import 'reflect-metadata';
import { config } from 'dotenv';

config({ path: '.env' });
config({
  path: `.env.${process.env.NODE_ENV ?? 'development'}`,
  override: true,
});

import { PrismaService } from '../src/infrastructure/database/prisma.service.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const prisma = new PrismaService(
    { url: databaseUrl } as never,
    { fieldEncryptionKey: undefined } as never,
  );

  try {
    const owned = await prisma.db.subscriptionAddOn.findMany({
      where: { is_deleted: false, status: 'ACTIVE' },
      include: {
        add_on: { select: { code: true, subscription_plan_id: true } },
        subscription: {
          select: {
            organization_id: true,
            subscription_plan_id: true,
            subscription_plan: { select: { plan: true } },
          },
        },
      },
    });
    const mismatched = owned.filter(
      (row) =>
        row.add_on.subscription_plan_id !==
        row.subscription.subscription_plan_id,
    );

    if (mismatched.length === 0) {
      console.log('No mismatched add-ons found. Nothing to do.');
      return;
    }

    for (const row of mismatched) {
      console.log(
        `org ${row.subscription.organization_id}: add-on ${row.add_on.code} ` +
          `(qty ${row.quantity}) does not belong to current plan ` +
          `${row.subscription.subscription_plan.plan} -> ` +
          (apply ? 'CANCELLING' : 'would cancel'),
      );
    }

    if (!apply) {
      console.log(
        `\nDry-run: ${mismatched.length} row(s) would be cancelled. ` +
          'Re-run with --apply to cancel them.',
      );
      return;
    }

    const result = await prisma.db.subscriptionAddOn.updateMany({
      where: { id: { in: mismatched.map((row) => row.id) } },
      data: { status: 'CANCELLED', ends_at: new Date() },
    });
    console.log(`\nCancelled ${result.count} mismatched add-on row(s).`);
  } finally {
    await prisma.onModuleDestroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
