import { Injectable } from '@nestjs/common';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PatientSubrecordReadService } from './patient-subrecord-read.service';

// Read-only. Writes happen via `PATCH /patients/:id/obgyn-history`, which
// owns the singleton `version` token across the entire history surface.
@Injectable()
export class AllergiesService extends PatientSubrecordReadService {
  findAll(patientId: string, user: AuthContext) {
    return this.read(patientId, user, () =>
      this.prismaService.db.patientAllergy.findMany({
        where: { patient_id: patientId, is_deleted: false },
        orderBy: { created_at: 'desc' },
      }),
    );
  }
}
