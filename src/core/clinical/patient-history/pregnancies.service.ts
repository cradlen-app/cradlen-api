import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PatientAccessService } from './patient-access.service';

// Read-only. Writes (and the cached G/P/A recompute) happen inside
// `PATCH /patients/:id/obgyn-history` so the singleton `version` token
// covers every history mutation.
@Injectable()
export class PregnanciesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly patientAccess: PatientAccessService,
  ) {}

  async findAll(patientId: string, user: AuthContext) {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    return this.prismaService.db.patientPregnancyHistory.findMany({
      where: { patient_id: patientId, is_deleted: false },
      orderBy: [{ birth_date: 'desc' }, { created_at: 'desc' }],
    });
  }
}
