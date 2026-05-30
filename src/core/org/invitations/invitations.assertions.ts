import {
  BadRequestException,
  ConflictException,
  GoneException,
  UnauthorizedException,
} from '@nestjs/common';
import { InvitationStatus } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { compareInvitationToken } from './invitations.tokens.js';

export async function assertNotSelfInvite(
  prisma: PrismaService,
  currentUserId: string,
  emails: string[],
): Promise<void> {
  if (!emails.length) return;
  const inviter = await prisma.db.user.findUnique({
    where: { id: currentUserId },
    select: { email: true },
  });
  const inviterEmail = inviter?.email?.toLowerCase() ?? null;
  if (!inviterEmail) return;
  if (emails.some((e) => e.toLowerCase() === inviterEmail)) {
    throw new BadRequestException('You cannot invite yourself');
  }
}

export interface RedeemableInvitation {
  token_hash: string;
  status: InvitationStatus;
  expires_at: Date;
}

export interface RedeemableOptions {
  checkExpiry?: boolean;
}

/**
 * Token-compare + status + expiry gate shared by accept/decline/preview.
 *
 * Policy:
 *  - bad token            → 401 'Invalid invitation token'
 *  - status === ACCEPTED  → 409 'Invitation already accepted'
 *  - status !== PENDING   → 401 'Invitation is not active'
 *  - expired (if checked) → 410 'Invitation expired'
 */
export async function assertInvitationRedeemable(
  invitation: RedeemableInvitation,
  rawToken: string,
  { checkExpiry = true }: RedeemableOptions = {},
): Promise<void> {
  const tokenMatches = await compareInvitationToken(
    rawToken,
    invitation.token_hash,
  );
  if (!tokenMatches) {
    throw new UnauthorizedException('Invalid invitation token');
  }
  if (invitation.status === InvitationStatus.ACCEPTED) {
    throw new ConflictException('Invitation already accepted');
  }
  if (invitation.status !== InvitationStatus.PENDING) {
    throw new UnauthorizedException('Invitation is not active');
  }
  if (checkExpiry && invitation.expires_at < new Date()) {
    throw new GoneException('Invitation expired');
  }
}
