import { Injectable } from '@nestjs/common';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PatientSubrecordReadService } from './patient-subrecord-read.service';

// Read-only. Writes (and the cached G/P/A recompute) happen inside
// `PATCH /patients/:id/obgyn-history` so the singleton `version` token
// covers every history mutation.
@Injectable()
export class PregnanciesService extends PatientSubrecordReadService {
  findAll(patientId: string, user: AuthContext) {
    return this.read(patientId, user, () =>
      this.prismaService.db.patientPregnancyHistory.findMany({
        where: { patient_id: patientId, is_deleted: false },
        orderBy: [{ birth_date: 'desc' }, { created_at: 'desc' }],
      }),
    );
  }
}
