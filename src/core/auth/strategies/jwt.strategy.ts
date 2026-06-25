import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import authConfig from '@config/auth.config.js';
import type { JwtAccessPayload } from '../interfaces/jwt-payload.interface.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(authConfig.KEY)
    config: ConfigType<typeof authConfig>,
    private readonly authorizationService: AuthorizationService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwt.accessSecret,
    });
  }

  async validate(
    payload: JwtAccessPayload & {
      aud?: string | string[];
      iss?: string;
      iat?: number;
    },
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
      payload.iat,
    );
  }
}
