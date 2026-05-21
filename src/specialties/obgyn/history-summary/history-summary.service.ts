import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { ObgynPatientAccessService } from '../patient-access.service';
import { ObgynHistorySummaryDto } from './dto/obgyn-history-summary.dto';

@Injectable()
export class HistorySummaryService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: ObgynPatientAccessService,
  ) {}

  async getObgynHistorySummary(
    patientId: string,
    user: { organizationId: string; [key: string]: unknown },
  ): Promise<ObgynHistorySummaryDto> {
    await this.access.assertPatientInOrg(patientId, user as any);

    const [history, allergies, medications] = await Promise.all([
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
          is_ongoing: true,
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
      section_timestamps: history.section_timestamps as Record<string, string> | null,
    };
  }
}
