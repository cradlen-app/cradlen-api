import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import type { ForgotPasswordDto } from '../dto/forgot-password.dto.js';
import type { ResendResetCodeDto } from '../dto/resend-reset-code.dto.js';
import type { VerifyResetCodeDto } from '../dto/verify-reset-code.dto.js';
import type { ResetPasswordDto } from '../dto/reset-password.dto.js';
import type { ResetTokenResponseDto } from '../dto/reset-token-response.dto.js';
import { TokensService } from './tokens.service.js';
import { VerificationCodesService } from './verification-codes.service.js';
import {
  AUTH_EVENTS,
  type AuthPasswordResetCompletedPayload,
} from '../events/auth.events.js';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly tokensService: TokensService,
    private readonly verificationCodesService: VerificationCodesService,
    private readonly eventBus: EventBus,
  ) {}

  async start(dto: ForgotPasswordDto): Promise<ResetTokenResponseDto> {
    const user = await this.prismaService.db.user.findFirst({
      where: {
        email: dto.email,
        is_deleted: false,
        is_active: true,
        verified_at: { not: null },
      },
    });

    if (!user?.email) {
      // No legitimate target. Return a well-formed reset token bound to a
      // throwaway userId so the response shape, length, and presence of a
      // token are indistinguishable from the real path. Subsequent
      // verify-reset-code attempts against this token return INVALID_CODE
      // just as they would for a wrong code against a real account, so the
      // symmetry holds through the rest of the flow. The bcrypt pad below
      // burns the same wall-clock cost as the real OTP hash so coarse
      // timing analysis cannot distinguish either path. Resend latency
      // and the verify-reset-code timing gap are noted as a residual
      // (downstream verify path can still be padded later).
      await bcrypt.hash(randomBytes(16).toString('hex'), 10);
      return this.tokensService.issuePasswordResetToken(
        randomUUID(),
        dto.email,
        false,
      );
    }

    await this.verificationCodesService.send({
      userId: user.id,
      target: user.email,
      purpose: 'PASSWORD_RESET',
    });

    return this.tokensService.issuePasswordResetToken(
      user.id,
      user.email,
      false,
    );
  }

  async resend(dto: ResendResetCodeDto): Promise<ResetTokenResponseDto> {
    const { userId, target } = this.tokensService.decodePasswordResetToken(
      dto.reset_token,
      false,
    );

    await this.verificationCodesService.assertCanResend({
      userId,
      purpose: 'PASSWORD_RESET',
    });

    await this.verificationCodesService.send({
      userId,
      target,
      purpose: 'PASSWORD_RESET',
      isResend: true,
    });

    return this.tokensService.issuePasswordResetToken(userId, target, false);
  }

  async verify(dto: VerifyResetCodeDto): Promise<ResetTokenResponseDto> {
    const { userId, target } = this.tokensService.decodePasswordResetToken(
      dto.reset_token,
      false,
    );

    // consume() runs first so synthetic-userId tokens (forgot-password on
    // an unknown email) fail with INVALID_CODE before we write a
    // PasswordResetToken row that would FK-violate. The real-but-wrong-code
    // and synthetic-token paths therefore return the same error and reach
    // the same point in the flow.
    await this.verificationCodesService.consume({
      userId,
      target,
      purpose: 'PASSWORD_RESET',
      code: dto.code,
    });

    const issued = this.tokensService.issuePasswordResetToken(
      userId,
      target,
      true,
    );
    // Track the verified jti so reset() can detect re-use.
    const verifiedPayload = this.tokensService.decodePasswordResetToken(
      issued.reset_token,
      true,
    );
    await this.prismaService.db.passwordResetToken.create({
      data: {
        jti: verifiedPayload.jti,
        user_id: userId,
        target,
        expires_at: new Date(Date.now() + issued.expires_in * 1000),
      },
    });

    return issued;
  }

  async reset(dto: ResetPasswordDto): Promise<void> {
    const { userId, target, jti } = this.tokensService.decodePasswordResetToken(
      dto.reset_token,
      true,
    );

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    // Single transaction: atomically (a) mark the reset jti consumed,
    // (b) update the password, (c) revoke every active refresh token.
    // The updateMany count check on consumed_at = null defends against
    // a concurrent second reset attempt with the same token — the loser
    // sees count = 0 and rolls back without touching the password.
    await this.prismaService.db.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { jti, consumed_at: null },
        data: { consumed_at: new Date() },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedException('Reset token already used or expired');
      }
      await tx.user.update({
        where: { id: userId },
        data: { password_hashed: passwordHash },
      });
      await tx.refreshToken.updateMany({
        where: { user_id: userId, is_revoked: false },
        data: { is_revoked: true },
      });
    });

    const payload: AuthPasswordResetCompletedPayload = {
      user_id: userId,
      target,
      completed_at: new Date(),
    };
    this.eventBus.publish(AUTH_EVENTS.passwordReset.completed, payload);
  }
}
