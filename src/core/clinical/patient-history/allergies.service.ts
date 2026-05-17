import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PatientAccessService } from './patient-access.service';

// Read-only. Writes happen via `PATCH /patients/:id/obgyn-history`, which
// owns the singleton `version` token across the entire history surface.
@Injectable()
export class AllergiesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly patientAccess: PatientAccessService,
  ) {}

  async findAll(patientId: string, user: AuthContext) {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    return this.prismaService.db.patientAllergy.findMany({
      where: { patient_id: patientId, is_deleted: false },
      orderBy: { created_at: 'desc' },
    });
  }
}
