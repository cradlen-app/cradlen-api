import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { computeMedicationEndDate } from './medication-duration.util.js';
import {
  PatientMedicationItemDto,
  PatientMedicationsResponseDto,
} from './dto/patient-medication.dto.js';

@Injectable()
export class PatientMedicationsService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Lists the caller's prescribed medications (visit prescriptions only),
   * split into CURRENT vs PAST by duration: a course is CURRENT while its
   * computed end date is in the future, or when it has no parseable duration
   * (open-ended). Scoped to the patients the caller may access.
   */
  async listMedications(
    ctx: PatientAuthContext,
    patientId?: string,
  ): Promise<PatientMedicationsResponseDto> {
    const targetIds = this.resolveTargetPatientIds(ctx, patientId);
    if (targetIds.length === 0) return { current: [], past: [] };

    const items = await this.prismaService.db.prescriptionItem.findMany({
      where: {
        is_deleted: false,
        prescription: {
          is_deleted: false,
          visit: {
            is_deleted: false,
            episode: { journey: { patient_id: { in: targetIds } } },
          },
        },
      },
      include: {
        medication: true,
        prescription: {
          include: {
            prescribed_by: { include: { user: true } },
            visit: { include: { branch: true } },
          },
        },
      },
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const current: PatientMedicationItemDto[] = [];
    const past: PatientMedicationItemDto[] = [];

    for (const item of items) {
      const prescribedAt = item.prescription.prescribed_at;
      const endDate = computeMedicationEndDate(prescribedAt, item.duration);
      const isCurrent = endDate === null || endDate >= todayStart;

      const dto = this.toDto(item, endDate, isCurrent);
      (isCurrent ? current : past).push(dto);
    }

    const byPrescribedDesc = (
      a: PatientMedicationItemDto,
      b: PatientMedicationItemDto,
    ) => b.prescribed_at.getTime() - a.prescribed_at.getTime();
    current.sort(byPrescribedDesc);
    past.sort(byPrescribedDesc);

    return { current, past };
  }

  private resolveTargetPatientIds(
    ctx: PatientAuthContext,
    patientId?: string,
  ): string[] {
    if (!patientId) return ctx.accessiblePatientIds;
    if (!ctx.accessiblePatientIds.includes(patientId)) {
      // Generic 404 — never reveal another patient's existence.
      throw new NotFoundException('No matching record found');
    }
    return [patientId];
  }

  private toDto(
    item: PrescriptionItemWithRelations,
    endDate: Date | null,
    isCurrent: boolean,
  ): PatientMedicationItemDto {
    const medication = item.medication;
    const visit = item.prescription.visit;
    const prescriber = item.prescription.prescribed_by?.user ?? null;

    return {
      id: item.id,
      name: medication?.name ?? item.custom_drug_name ?? 'Unknown',
      generic_name: medication?.generic_name ?? null,
      strength: medication?.strength ?? null,
      form: medication?.form ?? null,
      category: medication?.category ?? null,
      dose: item.dose,
      frequency: item.frequency,
      duration: item.duration ?? null,
      instructions: item.instructions ?? null,
      route: item.route ?? null,
      visit_date: visit.scheduled_at,
      prescribed_at: item.prescription.prescribed_at,
      end_date: endDate,
      is_current: isCurrent,
      doctor_name: prescriber
        ? `Dr. ${prescriber.first_name} ${prescriber.last_name}`.trim()
        : null,
      clinic_name: visit.branch?.name ?? null,
    };
  }
}

type PrescriptionItemWithRelations =
  import('@prisma/client').PrescriptionItem & {
    medication: import('@prisma/client').Medication | null;
    prescription: import('@prisma/client').Prescription & {
      prescribed_by:
        | (import('@prisma/client').Profile & {
            user: import('@prisma/client').User | null;
          })
        | null;
      visit: import('@prisma/client').Visit & {
        branch: import('@prisma/client').Branch | null;
      };
    };
  };
