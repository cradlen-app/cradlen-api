import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PatientAccessService } from './patient-access.service';

type SnapshotField =
  | 'gynecological_baseline'
  | 'gynecologic_procedures'
  | 'screening_history'
  | 'medical_chronic_illnesses'
  | 'family_history'
  | 'fertility_history'
  | 'social_history';

@Injectable()
export class SnapshotService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly patientAccess: PatientAccessService,
  ) {}

  async getBundle(patientId: string, user: AuthContext) {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    const p = await this.prismaService.db.patient.findUnique({
      where: { id: patientId, is_deleted: false },
      select: {
        id: true,
        gynecological_baseline: true,
        gynecologic_procedures: true,
        screening_history: true,
        obstetric_summary: true,
        medical_chronic_illnesses: true,
        family_history: true,
        fertility_history: true,
        social_history: true,
      },
    });
    return {
      patient_id: p!.id,
      gynecological_baseline: p!.gynecological_baseline,
      gynecologic_procedures: p!.gynecologic_procedures,
      screening_history: p!.screening_history,
      obstetric_summary: p!.obstetric_summary,
      medical_chronic_illnesses: p!.medical_chronic_illnesses,
      family_history: p!.family_history,
      fertility_history: p!.fertility_history,
      social_history: p!.social_history,
    };
  }

  async putSnapshot(
    patientId: string,
    field: SnapshotField,
    value: object,
    user: AuthContext,
  ) {
    await this.patientAccess.assertPatientInOrg(patientId, user);
    return this.prismaService.db.patient.update({
      where: { id: patientId },
      data: { [field]: value as Prisma.InputJsonValue },
      select: { id: true, [field]: true },
    });
  }
}
