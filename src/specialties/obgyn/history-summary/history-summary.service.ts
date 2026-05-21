import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
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
    user: AuthContext,
  ): Promise<ObgynHistorySummaryDto> {
    await this.access.assertPatientInOrg(patientId, user);

    const history = await this.prismaService.db.patientObgynHistory.findUnique({
      where: { patient_id: patientId, is_deleted: false },
      select: {
        obstetric_summary: true,
        gynecological_baseline: true,
        medical_chronic_illnesses: true,
        family_history: true,
        social_history: true,
        screening_history: true,
        section_timestamps: true,
        patient: {
          select: {
            allergies: {
              where: { is_deleted: false },
              select: {
                allergy_to: true,
                severity: true,
                associated_symptoms: true,
              },
            },
            current_medications: {
              where: { is_deleted: false, is_ongoing: true },
              select: {
                drug_name: true,
                dose: true,
                frequency: true,
                is_ongoing: true,
              },
            },
          },
        },
      },
    });

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

    const allergies = (history as unknown as { allergies?: ObgynHistorySummaryDto['allergies']; patient?: { allergies: ObgynHistorySummaryDto['allergies'] } }).allergies
      ?? history.patient?.allergies
      ?? [];

    const current_medications = (history as unknown as { medications?: ObgynHistorySummaryDto['current_medications']; patient?: { current_medications: ObgynHistorySummaryDto['current_medications'] } }).medications
      ?? history.patient?.current_medications
      ?? [];

    return {
      history_exists: true,
      allergies,
      current_medications,
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
