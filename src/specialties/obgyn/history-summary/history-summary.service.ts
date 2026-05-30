import { Injectable } from '@nestjs/common';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { coerceStringRecord } from '@common/utils/json.utils';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public';
import { ObgynHistorySummaryDto } from './dto/obgyn-history-summary.dto';

@Injectable()
export class HistorySummaryService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: PatientAccessService,
  ) {}

  async getObgynHistorySummary(
    patientId: string,
    user: AuthContext,
  ): Promise<ObgynHistorySummaryDto> {
    await this.access.assertPatientInOrg(patientId, user);

    const [history, allergies, medications] = await Promise.all([
      // is_deleted: false intentionally applied here — read path never returns soft-deleted singletons.
      // The write path (ObgynHistoryService.loadOrCreateSingleton) omits this filter because it
      // lazy-creates the row, making a deleted+recreated scenario possible there.
      this.prismaService.db.patientObgynHistory.findUnique({
        where: { patient_id: patientId, is_deleted: false },
        select: {
          obstetric_summary: true,
          gynecological_baseline: true,
          medical_chronic_illnesses: true,
          family_history: true,
          social_history: true,
          screening_history: true,
          section_timestamps: true,
        },
      }),
      this.prismaService.db.patientAllergy.findMany({
        where: { patient_id: patientId, is_deleted: false },
        select: {
          allergy_to: true,
          severity: true,
          associated_symptoms: true,
        },
      }),
      this.prismaService.db.patientMedication.findMany({
        where: { patient_id: patientId, is_deleted: false, is_ongoing: true },
        select: {
          drug_name: true,
          dose: true,
          frequency: true,
        },
      }),
    ]);

    if (!history) {
      return {
        history_exists: false,
        allergies: [],
        current_medications: [],
        obstetric_summary: null,
        gynecological_baseline: null,
        medical_chronic_illnesses: null,
        family_history: null,
        social_history: null,
        screening_history: null,
        section_timestamps: null,
      };
    }

    const sectionTimestamps = coerceStringRecord(history.section_timestamps);

    return {
      history_exists: true,
      allergies,
      current_medications: medications,
      obstetric_summary: history.obstetric_summary,
      gynecological_baseline: history.gynecological_baseline,
      medical_chronic_illnesses: history.medical_chronic_illnesses,
      family_history: history.family_history,
      social_history: history.social_history,
      screening_history: history.screening_history,
      section_timestamps: sectionTimestamps,
    };
  }
}
