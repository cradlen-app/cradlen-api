import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { AuthConfig } from '@config/auth.config.js';
import type { JwtAccessPayload } from '../interfaces/jwt-payload.interface.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {
    const authConfig = configService.get<AuthConfig>('auth');
    if (!authConfig) throw new Error('Auth configuration not loaded');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: authConfig.jwt.accessSecret,
    });
  }

  async validate(payload: JwtAccessPayload) {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.prismaService.db.user.findFirst({
      where: { id: payload.userId, is_deleted: false, is_active: true },
    });

    if (!user) throw new UnauthorizedException('User not found or inactive');

    return this.authorizationService.getProfileContext(
      payload.userId,
      payload.profileId,
      payload.organizationId,
      payload.activeBranchId,
    );
  }
}
