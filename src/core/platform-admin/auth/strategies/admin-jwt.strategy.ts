import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import authConfig from '@config/auth.config.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { AdminAuthContext } from '@common/interfaces/admin-auth-context.interface.js';
import type { JwtAdminAccessPayload } from '@core/auth/interfaces/jwt-payload.interface.js';

const JWT_AUDIENCE = 'cradlen-api';
const JWT_ISSUER = 'cradlen-api';

/**
 * Validates platform-admin access tokens. Mirrors PatientJwtStrategy: reuses the
 * shared access secret but gates on a distinct `type` claim and loads a
 * PlatformAdmin (no org/profile) instead of a staff ProfileContext.
 */
@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(
    @Inject(authConfig.KEY)
    config: ConfigType<typeof authConfig>,
    private readonly prismaService: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwt.accessSecret,
    });
  }

  async validate(
    payload: JwtAdminAccessPayload & {
      aud?: string | string[];
      iss?: string;
    },
  ): Promise<AdminAuthContext> {
    if (payload.type !== 'admin_access') {
      throw new UnauthorizedException('Invalid token type');
    }

    // aud + iss grace-period check, mirroring JwtStrategy / PatientJwtStrategy.
    const aud = payload.aud;
    if (aud !== undefined) {
      const audList = Array.isArray(aud) ? aud : [aud];
      if (!audList.includes(JWT_AUDIENCE)) {
        throw new UnauthorizedException('Invalid token audience');
      }
    }
    if (payload.iss !== undefined && payload.iss !== JWT_ISSUER) {
      throw new UnauthorizedException('Invalid token issuer');
    }

    const admin = await this.prismaService.db.platformAdmin.findFirst({
      where: { id: payload.adminId, is_active: true, is_deleted: false },
      select: { id: true, email: true },
    });
    if (!admin) throw new UnauthorizedException('Invalid auth context');

    return { adminId: admin.id, email: admin.email };
  }
}
