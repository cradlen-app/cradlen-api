import {
  BadRequestException,
  ConflictException,
  GoneException,
  UnauthorizedException,
} from '@nestjs/common';
import { InvitationStatus } from '@prisma/client';
import {
  assertInvitationRedeemable,
  assertNotSelfInvite,
} from './invitations.assertions';
import { hashInvitationToken } from './invitations.tokens';
import { PrismaService } from '@infrastructure/database/prisma.service';

describe('assertNotSelfInvite', () => {
  const buildPrisma = (email: string | null) =>
    ({
      db: {
        user: {
          findUnique: jest.fn().mockResolvedValue(email ? { email } : null),
        },
      },
    }) as unknown as PrismaService;

  it('throws when an invited email matches the inviter (case-insensitive)', async () => {
    const prisma = buildPrisma('Inviter@Cradlen.com');
    await expect(
      assertNotSelfInvite(prisma, 'user-1', ['INVITER@cradlen.com']),
    ).rejects.toThrow(BadRequestException);
  });

  it('passes when no email matches', async () => {
    const prisma = buildPrisma('inviter@cradlen.com');
    await expect(
      assertNotSelfInvite(prisma, 'user-1', ['other@cradlen.com']),
    ).resolves.toBeUndefined();
  });

  it('passes when inviter has no email on record', async () => {
    const prisma = buildPrisma(null);
    await expect(
      assertNotSelfInvite(prisma, 'user-1', ['other@cradlen.com']),
    ).resolves.toBeUndefined();
  });

  it('skips the DB lookup for an empty email list', async () => {
    const prisma = buildPrisma('inviter@cradlen.com');
    await assertNotSelfInvite(prisma, 'user-1', []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma.db.user as any).findUnique).not.toHaveBeenCalled();
  });
});

describe('assertInvitationRedeemable', () => {
  const buildInvitation = (
    overrides: Partial<{
      status: InvitationStatus;
      expiresInMs: number;
    }> = {},
  ) => {
    const rawToken = 'good-token';
    const token_hash = hashInvitationToken(rawToken);
    return {
      rawToken,
      invitation: {
        token_hash,
        status: overrides.status ?? InvitationStatus.PENDING,
        expires_at: new Date(
          Date.now() + (overrides.expiresInMs ?? 60 * 60 * 1000),
        ),
      },
    };
  };

  it('passes for a pending, non-expired invitation with the right token', async () => {
    const { rawToken, invitation } = buildInvitation();
    await expect(
      assertInvitationRedeemable(invitation, rawToken),
    ).resolves.toBeUndefined();
  });

  it('throws 401 when the token does not match', async () => {
    const { invitation } = buildInvitation();
    await expect(
      assertInvitationRedeemable(invitation, 'wrong-token'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws 409 when the invitation is already ACCEPTED', async () => {
    const { rawToken, invitation } = buildInvitation({
      status: InvitationStatus.ACCEPTED,
    });
    await expect(
      assertInvitationRedeemable(invitation, rawToken),
    ).rejects.toThrow(ConflictException);
  });

  it('throws 401 when the invitation is CANCELLED', async () => {
    const { rawToken, invitation } = buildInvitation({
      status: InvitationStatus.CANCELLED,
    });
    await expect(
      assertInvitationRedeemable(invitation, rawToken),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws 410 when the invitation is expired', async () => {
    const { rawToken, invitation } = buildInvitation({
      expiresInMs: -1_000,
    });
    await expect(
      assertInvitationRedeemable(invitation, rawToken),
    ).rejects.toThrow(GoneException);
  });

  it('skips the expiry check when checkExpiry is false', async () => {
    const { rawToken, invitation } = buildInvitation({
      expiresInMs: -1_000,
    });
    await expect(
      assertInvitationRedeemable(invitation, rawToken, { checkExpiry: false }),
    ).resolves.toBeUndefined();
  });
});
