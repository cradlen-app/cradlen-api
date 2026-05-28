import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthConfig } from '@config/auth.config.js';
import type { JwtAccessPayload } from '../interfaces/jwt-payload.interface.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
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

  async validate(
    payload: JwtAccessPayload & { aud?: string | string[]; iss?: string },
  ) {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    // aud + iss grace-period check. Tokens issued before TokensService
    // started attaching these claims are still accepted; new tokens MUST
    // carry the expected values. Once the grace window has passed in
    // production, replace these allow-undefined branches with hard
    // assertions and close the spec gap.
    const aud = payload.aud;
    if (aud !== undefined) {
      const audList = Array.isArray(aud) ? aud : [aud];
      if (!audList.includes('cradlen-api')) {
        throw new UnauthorizedException('Invalid token audience');
      }
    }
    if (payload.iss !== undefined && payload.iss !== 'cradlen-api') {
      throw new UnauthorizedException('Invalid token issuer');
    }

    // AuthorizationService.getProfileContext does the combined
    // profile + user + org existence check in a single query, then
    // loads branches in one more. No separate user.findFirst here.
    return this.authorizationService.getProfileContext(
      payload.userId,
      payload.profileId,
      payload.organizationId,
      payload.activeBranchId,
    );
  }
}
