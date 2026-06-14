import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import authConfig from '@config/auth.config.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import type { JwtPatientAccessPayload } from '@core/auth/interfaces/jwt-payload.interface.js';

const JWT_AUDIENCE = 'cradlen-api';
const JWT_ISSUER = 'cradlen-api';

@Injectable()
export class PatientJwtStrategy extends PassportStrategy(
  Strategy,
  'patient-jwt',
) {
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
    payload: JwtPatientAccessPayload & {
      aud?: string | string[];
      iss?: string;
    },
  ): Promise<PatientAuthContext> {
    if (payload.type !== 'patient_access') {
      throw new UnauthorizedException('Invalid token type');
    }

    // aud + iss grace-period check, mirroring JwtStrategy.
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

    const account = await this.prismaService.db.patientAccount.findFirst({
      where: { id: payload.accountId, is_active: true, is_deleted: false },
      select: { id: true, patient_id: true, guardian_id: true },
    });
    if (!account) throw new UnauthorizedException('Invalid auth context');

    const accessiblePatientIds = await this.resolveAccessiblePatients(payload);

    return {
      accountId: account.id,
      ...(payload.patientId && { patientId: payload.patientId }),
      ...(payload.guardianId && { guardianId: payload.guardianId }),
      accessiblePatientIds,
    };
  }

  private async resolveAccessiblePatients(
    payload: JwtPatientAccessPayload,
  ): Promise<string[]> {
    if (payload.patientId) return [payload.patientId];
    if (payload.guardianId) {
      const links = await this.prismaService.db.patientGuardian.findMany({
        where: {
          guardian_id: payload.guardianId,
          is_deleted: false,
          patient: { is_deleted: false },
        },
        select: { patient_id: true },
      });
      return links.map((l) => l.patient_id);
    }
    return [];
  }
}
