import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { User } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import authConfig, { type AuthConfig } from '@config/auth.config.js';
import type { AuthTokensDto } from '../dto/auth-tokens.dto.js';
import type { ResetTokenResponseDto } from '../dto/reset-token-response.dto.js';
import type { WsTicketResponseDto } from '../dto/ws-ticket-response.dto.js';
import type {
  JwtAccessPayload,
  JwtPatientAccessPayload,
  JwtPatientRefreshPayload,
  JwtRefreshPayload,
  JwtWsTicketPayload,
  PasswordResetTokenPayload,
  PatientResetTokenPayload,
  PatientSignupTokenPayload,
  SignupTokenPayload,
} from '../interfaces/jwt-payload.interface.js';
import {
  AUTH_EVENTS,
  type AuthRefreshRotatedPayload,
} from '../events/auth.events.js';

const BCRYPT_ROUNDS = 12;

/**
 * JWT `aud` and `iss` claims attached to every token this service issues.
 * Deployments running an older build sign tokens without these; this
 * service still accepts those during the grace window so a rolling
 * deploy never invalidates active sessions. After the grace window has
 * passed in production, drop the `undefined` branches in verifyWithGrace
 * and the matching ones in JwtStrategy.validate to close the spec gap.
 */
const JWT_AUDIENCE = 'cradlen-api';
const JWT_ISSUER = 'cradlen-api';

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

export interface IssuePatientTokenPairArgs {
  userId: string;
  patientId?: string;
  guardianId?: string;
  /**
   * When set, the existing patient refresh-token row with this jti is
   * atomically revoked in the same transaction as the new issuance (rotation).
   */
  revokeJti?: string;
}

@Injectable()
export class TokensService {
  private readonly authConfig: AuthConfig;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    @Inject(authConfig.KEY)
    config: ConfigType<typeof authConfig>,
    private readonly eventBus: EventBus,
  ) {
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
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
      expiresIn: expires_in,
    });
    return { signup_token, expires_in };
  }

  decodeSignupToken(
    token: string,
    expectedType: 'signup' | 'profile_selection',
  ): string {
    const payload = this.verifyWithGrace<SignupTokenPayload>(token, {
      secret: this.authConfig.jwt.accessSecret,
      errorMessage: 'Invalid or expired token',
    });
    if (payload.type !== expectedType)
      throw new UnauthorizedException('Invalid token type');
    return payload.userId;
  }

  issuePatientSignupToken(
    subjectType: 'PATIENT' | 'GUARDIAN',
    subjectId: string,
  ): { patient_signup_token: string; expires_in: number } {
    const payload: PatientSignupTokenPayload = {
      subjectType,
      subjectId,
      type: 'patient_signup',
    };
    const expires_in = this.parseDurationToSeconds(
      this.authConfig.jwt.registrationExpiration,
    );
    const patient_signup_token = this.jwtService.sign(payload, {
      secret: this.authConfig.jwt.accessSecret,
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
      expiresIn: expires_in,
    });
    return { patient_signup_token, expires_in };
  }

  decodePatientSignupToken(token: string): {
    subjectType: 'PATIENT' | 'GUARDIAN';
    subjectId: string;
  } {
    const payload = this.verifyWithGrace<PatientSignupTokenPayload>(token, {
      secret: this.authConfig.jwt.accessSecret,
      errorMessage: 'Invalid or expired token',
    });
    if (payload.type !== 'patient_signup')
      throw new UnauthorizedException('Invalid token type');
    return { subjectType: payload.subjectType, subjectId: payload.subjectId };
  }

  issuePatientResetToken(userId: string): {
    reset_token: string;
    expires_in: number;
  } {
    const payload: PatientResetTokenPayload = { userId, type: 'patient_reset' };
    const expires_in = this.parseDurationToSeconds(
      this.authConfig.jwt.registrationExpiration,
    );
    const reset_token = this.jwtService.sign(payload, {
      secret: this.authConfig.jwt.resetSecret,
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
      expiresIn: expires_in,
    });
    return { reset_token, expires_in };
  }

  decodePatientResetToken(token: string): { userId: string } {
    const payload = this.verifyWithGrace<PatientResetTokenPayload>(token, {
      secret: this.authConfig.jwt.resetSecret,
      errorMessage: 'Invalid or expired reset token',
    });
    if (payload.type !== 'patient_reset')
      throw new UnauthorizedException('Invalid token type');
    return { userId: payload.userId };
  }

  tryDecodeAccessToken(authorization?: string): string | null {
    if (!authorization) return null;

    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (!match) return null;

    try {
      const payload = this.verifyWithGrace<JwtAccessPayload>(match[1], {
        secret: this.authConfig.jwt.accessSecret,
        errorMessage: 'Invalid token',
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
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
      expiresIn,
    });
    return { reset_token, expires_in: expiresIn };
  }

  decodePasswordResetToken(
    token: string,
    expectedVerified: boolean,
  ): { userId: string; target: string; jti: string } {
    const payload = this.verifyWithGrace<PasswordResetTokenPayload>(token, {
      secret: this.authConfig.jwt.resetSecret,
      errorMessage: 'Invalid or expired reset token',
    });
    if (
      payload.type !== 'password_reset' ||
      payload.verified !== expectedVerified
    ) {
      throw new UnauthorizedException('Invalid reset token type or state');
    }
    return { userId: payload.userId, target: payload.target, jti: payload.jti };
  }

  decodeRefreshToken(token: string): JwtRefreshPayload {
    const payload = this.verifyWithGrace<JwtRefreshPayload>(token, {
      secret: this.authConfig.jwt.refreshSecret,
      errorMessage: 'Invalid or expired refresh token',
    });
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }
    return payload;
  }

  /**
   * Verifies a JWT with the supplied secret and asserts the `aud` claim
   * is either absent (legacy, grace) or matches JWT_AUDIENCE. Any
   * failure path collapses into the supplied user-facing message so
   * the caller cannot probe signature vs. audience vs. expiration.
   */
  private verifyWithGrace<T extends object>(
    token: string,
    opts: { secret: string; ignoreExpiration?: boolean; errorMessage: string },
  ): T {
    let payload: T;
    try {
      payload = this.jwtService.verify<T>(token, {
        secret: opts.secret,
        ignoreExpiration: opts.ignoreExpiration ?? false,
      });
    } catch {
      throw new UnauthorizedException(opts.errorMessage);
    }
    const claims = payload as { aud?: string | string[]; iss?: string };
    if (claims.aud !== undefined) {
      const audList = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!audList.includes(JWT_AUDIENCE)) {
        throw new UnauthorizedException(opts.errorMessage);
      }
    }
    if (claims.iss !== undefined && claims.iss !== JWT_ISSUER) {
      throw new UnauthorizedException(opts.errorMessage);
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
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
      expiresIn: accessExpiresIn,
    });
    const refresh_token = this.jwtService.sign(refreshPayload, {
      secret: this.authConfig.jwt.refreshSecret,
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
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
          data: {
            is_revoked: true,
            revoked_at: new Date(),
            replaced_by_jti: jti,
          },
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

  /**
   * Mints a short-lived ticket the browser passes in the Socket.IO handshake.
   * The caller is already authenticated (a valid access token reached the
   * `@CurrentUser` context), so there is no profile assertion and no
   * refresh-token row — the ticket is single-purpose, stateless, and expires in
   * seconds. It carries the same `profileId`/`activeBranchId` the gateway uses
   * to derive room membership.
   */
  issueWsTicket(args: IssueTokenPairArgs): WsTicketResponseDto {
    const expires_in = this.parseDurationToSeconds(
      this.authConfig.jwt.wsTicketExpiration,
    );
    const payload: JwtWsTicketPayload = {
      userId: args.user.id,
      profileId: args.profileId,
      organizationId: args.organizationId,
      ...(args.activeBranchId && { activeBranchId: args.activeBranchId }),
      type: 'ws',
    };
    const ws_ticket = this.jwtService.sign(payload, {
      secret: this.authConfig.jwt.accessSecret,
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
      expiresIn: expires_in,
    });
    return { ws_ticket, expires_in };
  }

  /**
   * Issues an access + refresh pair for a self-registered patient/guardian.
   * The refresh row is persisted with only `user_id` set (profile/org/branch
   * are null) so a future patient-refresh endpoint can rotate it. Unlike the
   * staff path there is no profile to assert against.
   */
  async issuePatientTokenPair(
    args: IssuePatientTokenPairArgs,
  ): Promise<AuthTokensDto> {
    const jti = randomUUID();
    const accessExpiresIn = this.parseDurationToSeconds(
      this.authConfig.jwt.accessExpiration,
    );
    const refreshExpiresIn = this.parseDurationToSeconds(
      this.authConfig.jwt.refreshExpiration,
    );
    const accessPayload: JwtPatientAccessPayload = {
      userId: args.userId,
      ...(args.patientId && { patientId: args.patientId }),
      ...(args.guardianId && { guardianId: args.guardianId }),
      type: 'patient_access',
    };
    const refreshPayload: JwtPatientRefreshPayload = {
      userId: args.userId,
      ...(args.patientId && { patientId: args.patientId }),
      ...(args.guardianId && { guardianId: args.guardianId }),
      jti,
      type: 'patient_refresh',
    };
    const access_token = this.jwtService.sign(accessPayload, {
      secret: this.authConfig.jwt.accessSecret,
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
      expiresIn: accessExpiresIn,
    });
    const refresh_token = this.jwtService.sign(refreshPayload, {
      secret: this.authConfig.jwt.refreshSecret,
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
      expiresIn: refreshExpiresIn,
    });
    const token_hash = await bcrypt.hash(refresh_token, BCRYPT_ROUNDS);

    // Same atomic rotation guard as issueTokenPair: when rotating, the old
    // jti is revoked in the same transaction as the new-row create, and a
    // count check rejects a double-rotate.
    await this.prismaService.db.$transaction(async (tx) => {
      if (args.revokeJti) {
        const revoked = await tx.refreshToken.updateMany({
          where: { jti: args.revokeJti, is_revoked: false },
          data: {
            is_revoked: true,
            revoked_at: new Date(),
            replaced_by_jti: jti,
          },
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
          user_id: args.userId,
          profile_id: null,
          organization_id: null,
          active_branch_id: null,
          expires_at: new Date(Date.now() + refreshExpiresIn * 1000),
        },
      });
    });

    return {
      type: 'tokens',
      access_token,
      refresh_token,
      token_type: 'Bearer',
      expires_in: accessExpiresIn,
    };
  }

  decodePatientRefreshToken(token: string): JwtPatientRefreshPayload {
    const payload = this.verifyWithGrace<JwtPatientRefreshPayload>(token, {
      secret: this.authConfig.jwt.refreshSecret,
      errorMessage: 'Invalid or expired refresh token',
    });
    if (payload.type !== 'patient_refresh') {
      throw new UnauthorizedException('Invalid token type');
    }
    return payload;
  }

  async revokeRefreshToken(rawRefreshToken: string): Promise<void> {
    try {
      const payload = this.verifyWithGrace<
        JwtRefreshPayload | JwtPatientRefreshPayload
      >(rawRefreshToken, {
        secret: this.authConfig.jwt.refreshSecret,
        ignoreExpiration: true,
        errorMessage: 'Invalid token',
      });
      // Both staff (`refresh`) and patient (`patient_refresh`) tokens are
      // revoked by jti — the lookup is type-agnostic.
      if (payload.type !== 'refresh' && payload.type !== 'patient_refresh') {
        return;
      }
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
