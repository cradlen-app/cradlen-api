import { Injectable } from '@nestjs/common';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PatientSubrecordReadService } from './patient-subrecord-read.service';

// Read-only. Writes happen via `PATCH /patients/:id/obgyn-history`.
@Injectable()
export class PatientMedicationsService extends PatientSubrecordReadService {
  findAll(patientId: string, user: AuthContext) {
    return this.read(patientId, user, () =>
      this.prismaService.db.patientMedication.findMany({
        where: { patient_id: patientId, is_deleted: false },
        orderBy: [
          { is_ongoing: 'desc' },
          { from_date: 'desc' },
          { created_at: 'desc' },
        ],
      }),
    );
  }
}
