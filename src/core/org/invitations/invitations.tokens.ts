import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '@config/app.config.js';
import type { AuthConfig } from '@config/auth.config.js';

export interface GeneratedInvitationToken {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

// Tokens are 128-bit random UUIDs (high-entropy, not user-derived), so a
// password-grade KDF like bcrypt is unnecessary. SHA-256 with a constant-time
// compare is safe and ~100× faster on verify. The `sha256:` prefix lets us
// detect legacy bcrypt hashes during a transition window without a DB migration
// (existing tokens expire on their own within the invitation TTL).
const SHA256_PREFIX = 'sha256:';

export function hashInvitationToken(rawToken: string): string {
  return SHA256_PREFIX + createHash('sha256').update(rawToken).digest('hex');
}

export async function compareInvitationToken(
  rawToken: string,
  storedHash: string,
): Promise<boolean> {
  if (storedHash.startsWith(SHA256_PREFIX)) {
    const expected = Buffer.from(storedHash.slice(SHA256_PREFIX.length), 'hex');
    const actual = createHash('sha256').update(rawToken).digest();
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }
  // Legacy bcrypt hashes — remove this branch after the longest possible
  // invitation TTL has elapsed since deploy.
  return bcrypt.compare(rawToken, storedHash);
}

export function generateInvitationToken(
  authConfig: AuthConfig,
): GeneratedInvitationToken {
  const rawToken = randomUUID();
  const tokenHash = hashInvitationToken(rawToken);
  const expiresAt = new Date(
    Date.now() + authConfig.invitationExpireHours * 60 * 60 * 1000,
  );
  return { rawToken, tokenHash, expiresAt };
}

export function buildInvitationAcceptUrl(
  appConfig: AppConfig,
  invitationId: string,
  rawToken: string,
): string {
  return `${appConfig.appUrl}/invitations/accept?invitation=${invitationId}&token=${rawToken}`;
}
