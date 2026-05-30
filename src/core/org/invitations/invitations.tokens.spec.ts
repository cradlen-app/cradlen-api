import * as bcrypt from 'bcryptjs';
import type { AppConfig } from '@config/app.config';
import type { AuthConfig } from '@config/auth.config';
import {
  buildInvitationAcceptUrl,
  compareInvitationToken,
  generateInvitationToken,
  hashInvitationToken,
} from './invitations.tokens';

describe('hashInvitationToken / compareInvitationToken', () => {
  it('hashes with a sha256: prefix and verifies the round-trip', async () => {
    const hash = hashInvitationToken('my-token');
    expect(hash.startsWith('sha256:')).toBe(true);
    // 32 bytes hex = 64 chars
    expect(hash.slice('sha256:'.length)).toMatch(/^[0-9a-f]{64}$/);
    expect(await compareInvitationToken('my-token', hash)).toBe(true);
  });

  it('returns false on token mismatch (constant-time compare)', async () => {
    const hash = hashInvitationToken('good');
    expect(await compareInvitationToken('bad', hash)).toBe(false);
  });

  it('falls back to bcrypt for legacy stored hashes', async () => {
    const legacyHash = await bcrypt.hash('legacy-token', 4);
    expect(legacyHash.startsWith('sha256:')).toBe(false);
    expect(await compareInvitationToken('legacy-token', legacyHash)).toBe(true);
    expect(await compareInvitationToken('wrong', legacyHash)).toBe(false);
  });
});

describe('generateInvitationToken', () => {
  it('returns a UUID rawToken whose SHA-256 hash verifies and an expiry derived from config', async () => {
    const authConfig = { invitationExpireHours: 48 } as AuthConfig;

    const before = Date.now();
    const { rawToken, tokenHash, expiresAt } =
      generateInvitationToken(authConfig);
    const after = Date.now();

    expect(rawToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(tokenHash.startsWith('sha256:')).toBe(true);
    expect(await compareInvitationToken(rawToken, tokenHash)).toBe(true);

    const expectedMs = 48 * 60 * 60 * 1000;
    const expiresMs = expiresAt.getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + expectedMs - 100);
    expect(expiresMs).toBeLessThanOrEqual(after + expectedMs + 100);
  });

  it('returns a distinct rawToken on each call', () => {
    const authConfig = { invitationExpireHours: 24 } as AuthConfig;
    const a = generateInvitationToken(authConfig);
    const b = generateInvitationToken(authConfig);
    expect(a.rawToken).not.toEqual(b.rawToken);
    expect(a.tokenHash).not.toEqual(b.tokenHash);
  });
});

describe('buildInvitationAcceptUrl', () => {
  it('produces a deterministic URL composed of appUrl + ids', () => {
    const url = buildInvitationAcceptUrl(
      { appUrl: 'https://app.cradlen.com' } as AppConfig,
      'inv-id',
      'raw-token',
    );
    expect(url).toBe(
      'https://app.cradlen.com/invitations/accept?invitation=inv-id&token=raw-token',
    );
  });
});
