import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

/**
 * Bootstraps the first platform admin from env. There is no self-signup for
 * platform admins, so this seed is the only sanctioned way to create the
 * founding operator account; further admins are managed in-app.
 *
 * Idempotent: upserts on email, re-hashing the password each run so rotating
 * `PLATFORM_ADMIN_PASSWORD` in env and re-seeding updates the credential.
 * Skips (with a warning) when the env vars are absent, so the general
 * `prisma db seed` still completes on machines that don't provision an admin.
 */
export async function seedPlatformAdmin(prisma: PrismaClient): Promise<void> {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  const fullName = process.env.PLATFORM_ADMIN_NAME?.trim() || 'Platform Admin';

  if (!email || !password) {
    console.warn(
      '[seed] PLATFORM_ADMIN_EMAIL/PLATFORM_ADMIN_PASSWORD not set — skipping platform-admin bootstrap.',
    );
    return;
  }

  const password_hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await prisma.platformAdmin.upsert({
    where: { email },
    update: { password_hashed, full_name: fullName, is_active: true },
    create: { email, password_hashed, full_name: fullName },
  });

  console.log(`[seed] platform admin ready: ${email}`);
}
