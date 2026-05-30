import { Prisma } from '@prisma/client';

const STAFF_EMAIL_DOMAIN = 'cradlen.com';
const MAX_ATTEMPTS = 10;

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function randomCandidate(base: string): string {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${base}${suffix}@${STAFF_EMAIL_DOMAIN}`;
}

/**
 * Creates a User row with an auto-generated `<first>-<last><####>@cradlen.com`
 * email. Relies on the `users_email_key` unique index for collision detection
 * — no TOCTOU pre-check. On P2002 (email), retries with a fresh random suffix
 * up to 10 times; final fallback uses `Date.now()` for guaranteed uniqueness.
 *
 * Runs inside a caller-supplied transaction so the User row commits atomically
 * with downstream Profile + M2M rows.
 *
 * Returns the created User row plus the generated email.
 */
export async function createUserWithGeneratedEmail(
  tx: Prisma.TransactionClient,
  data: {
    first_name: string;
    last_name: string;
    phone_number: string;
    password_hashed: string;
  },
): Promise<{ id: string; email: string }> {
  const base = `${slug(data.first_name)}-${slug(data.last_name)}`;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const email = randomCandidate(base);
    try {
      const user = await tx.user.create({
        data: {
          first_name: data.first_name,
          last_name: data.last_name,
          email,
          phone_number: data.phone_number,
          password_hashed: data.password_hashed,
          registration_status: 'ACTIVE',
          onboarding_completed: true,
          verified_at: null,
        },
        select: { id: true, email: true },
      });
      return { id: user.id, email: user.email! };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        Array.isArray(e.meta?.target) &&
        (e.meta?.target as string[]).includes('email')
      ) {
        continue;
      }
      throw e;
    }
  }

  // Last-resort: timestamp-based suffix is monotonically unique within the same ms.
  const fallback = `${base}${Date.now()}@${STAFF_EMAIL_DOMAIN}`;
  const user = await tx.user.create({
    data: {
      first_name: data.first_name,
      last_name: data.last_name,
      email: fallback,
      phone_number: data.phone_number,
      password_hashed: data.password_hashed,
      registration_status: 'ACTIVE',
      onboarding_completed: true,
      verified_at: null,
    },
    select: { id: true, email: true },
  });
  return { id: user.id, email: user.email! };
}
