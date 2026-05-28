import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { User } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import type { AuthConfig } from '@config/auth.config.js';
import type { AuthTokensDto } from '../dto/auth-tokens.dto.js';
import type { ResetTokenResponseDto } from '../dto/reset-token-response.dto.js';
import type {
  JwtAccessPayload,
  JwtRefreshPayload,
  PasswordResetTokenPayload,
  SignupTokenPayload,
} from '../interfaces/jwt-payload.interface.js';
import {
  AUTH_EVENTS,
  type AuthRefreshRotatedPayload,
} from '../events/auth.events.js';

const BCRYPT_ROUNDS = 12;

export interface IssueTokenPairArgs {
  user: Pick<User, 'id'>;
  profileId: string;
  organizationId: string;
  activeBranchId?: string;
  /**
   * When set, the existing refresh-token row with this jti is atomically
   * revoked in the same transaction as the new refresh-token issuance.
   * A guarded updateMany rejects the rotation if the row is already revoked,
   * preventing two parallel refreshes from producing two valid sessions.
   */
  revokeJti?: string;
}

@Injectable()
export class TokensService {
  private readonly authConfig: AuthConfig;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly eventBus: EventBus,
  ) {
    const config = this.configService.get<AuthConfig>('auth');
    if (!config) throw new Error('Auth configuration not loaded');
    this.authConfig = config;
  }

  issueSignupToken(
    userId: string,
    type: 'signup' | 'profile_selection',
  ): { signup_token: string; expires_in: number } {
    const payload: SignupTokenPayload = { userId, type };
    const expires_in = this.parseDurationToSeconds(
      this.authConfig.jwt.registrationExpiration,
    );
    const signup_token = this.jwtService.sign(payload, {
      secret: this.authConfig.jwt.accessSecret,
      expiresIn: expires_in,
    });
    return { signup_token, expires_in };
  }

  decodeSignupToken(
    token: string,
    expectedType: 'signup' | 'profile_selection',
  ): string {
    let payload: SignupTokenPayload;
    try {
      payload = this.jwtService.verify<SignupTokenPayload>(token, {
        secret: this.authConfig.jwt.accessSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.type !== expectedType)
      throw new UnauthorizedException('Invalid token type');
    return payload.userId;
  }

  tryDecodeAccessToken(authorization?: string): string | null {
    if (!authorization) return null;

    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (!match) return null;

    try {
      const payload = this.jwtService.verify<JwtAccessPayload>(match[1], {
        secret: this.authConfig.jwt.accessSecret,
      });
      return payload.type === 'access' ? payload.userId : null;
    } catch {
      return null;
    }
  }

  issuePasswordResetToken(
    userId: string,
    target: string,
    verified: boolean,
  ): ResetTokenResponseDto {
    const jti = randomUUID();
    const payload: PasswordResetTokenPayload = {
      userId,
      target,
      jti,
      type: 'password_reset',
      verified,
    };
    const expiresIn = this.parseDurationToSeconds(
      this.authConfig.jwt.registrationExpiration,
    );
    const reset_token = this.jwtService.sign(payload, {
      secret: this.authConfig.jwt.resetSecret,
      expiresIn,
    });
    return { reset_token, expires_in: expiresIn };
  }

  decodePasswordResetToken(
    token: string,
    expectedVerified: boolean,
  ): { userId: string; target: string; jti: string } {
    let payload: PasswordResetTokenPayload;
    try {
      payload = this.jwtService.verify<PasswordResetTokenPayload>(token, {
        secret: this.authConfig.jwt.resetSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
    if (
      payload.type !== 'password_reset' ||
      payload.verified !== expectedVerified
    ) {
      throw new UnauthorizedException('Invalid reset token type or state');
    }
    return { userId: payload.userId, target: payload.target, jti: payload.jti };
  }

  decodeRefreshToken(token: string): JwtRefreshPayload {
    let payload: JwtRefreshPayload;
    try {
      payload = this.jwtService.verify<JwtRefreshPayload>(token, {
        secret: this.authConfig.jwt.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }
    return payload;
  }

  async issueTokenPair(args: IssueTokenPairArgs): Promise<AuthTokensDto> {
    await this.assertProfileBelongsToUser(
      args.user.id,
      args.profileId,
      args.organizationId,
    );

    const jti = randomUUID();
    const accessExpiresIn = this.parseDurationToSeconds(
      this.authConfig.jwt.accessExpiration,
    );
    const refreshExpiresIn = this.parseDurationToSeconds(
      this.authConfig.jwt.refreshExpiration,
    );
    const accessPayload: JwtAccessPayload = {
      userId: args.user.id,
      profileId: args.profileId,
      organizationId: args.organizationId,
      ...(args.activeBranchId && { activeBranchId: args.activeBranchId }),
      type: 'access',
    };
    const refreshPayload: JwtRefreshPayload = {
      userId: args.user.id,
      profileId: args.profileId,
      organizationId: args.organizationId,
      jti,
      type: 'refresh',
    };
    const access_token = this.jwtService.sign(accessPayload, {
      secret: this.authConfig.jwt.accessSecret,
      expiresIn: accessExpiresIn,
    });
    const refresh_token = this.jwtService.sign(refreshPayload, {
      secret: this.authConfig.jwt.refreshSecret,
      expiresIn: refreshExpiresIn,
    });
    const token_hash = await bcrypt.hash(refresh_token, BCRYPT_ROUNDS);

    // Atomic rotation: when revokeJti is provided, guard the revoke with a
    // count check inside the same transaction as the new-row create. If two
    // refreshes race for the same prior jti, only one updateMany returns
    // count=1 and that branch issues the new pair; the other rolls back.
    await this.prismaService.db.$transaction(async (tx) => {
      if (args.revokeJti) {
        const revoked = await tx.refreshToken.updateMany({
          where: { jti: args.revokeJti, is_revoked: false },
          data: { is_revoked: true, revoked_at: new Date() },
        });
        if (revoked.count !== 1) {
          throw new UnauthorizedException(
            'Refresh token already rotated or revoked',
          );
        }
      }
      await tx.refreshToken.create({
        data: {
          jti,
          token_hash,
          user_id: args.user.id,
          profile_id: args.profileId,
          organization_id: args.organizationId,
          active_branch_id: args.activeBranchId ?? null,
          expires_at: new Date(Date.now() + refreshExpiresIn * 1000),
        },
      });
    });

    if (args.revokeJti) {
      const payload: AuthRefreshRotatedPayload = {
        user_id: args.user.id,
        profile_id: args.profileId,
        organization_id: args.organizationId,
        old_jti: args.revokeJti,
        new_jti: jti,
        rotated_at: new Date(),
      };
      this.eventBus.publish(AUTH_EVENTS.refresh.rotated, payload);
    }

    return {
      type: 'tokens',
      access_token,
      refresh_token,
      token_type: 'Bearer',
      expires_in: accessExpiresIn,
    };
  }

  async revokeRefreshToken(rawRefreshToken: string): Promise<void> {
    try {
      const payload = this.jwtService.verify<JwtRefreshPayload>(
        rawRefreshToken,
        {
          secret: this.authConfig.jwt.refreshSecret,
          ignoreExpiration: true,
        },
      );
      if (payload.type !== 'refresh') return;
      await this.prismaService.db.refreshToken.updateMany({
        where: { jti: payload.jti, is_revoked: false },
        data: { is_revoked: true, revoked_at: new Date() },
      });
    } catch {
      return;
    }
  }

  parseDurationToSeconds(duration: string): number {
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match) return 900;
    const value = parseInt(match[1], 10);
    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };
    return value * (multipliers[match[2]] ?? 1);
  }

  private async assertProfileBelongsToUser(
    userId: string,
    profileId: string,
    organizationId: string,
  ): Promise<void> {
    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        id: profileId,
        user_id: userId,
        organization_id: organizationId,
        is_deleted: false,
        is_active: true,
      },
      select: { id: true },
    });
    if (!profile) throw new ForbiddenException('Invalid profile context');
  }
}
