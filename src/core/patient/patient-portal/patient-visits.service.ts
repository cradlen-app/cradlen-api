import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import type { PaginatedPayload } from '@common/dto/api-response.dto.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { resolveAccessiblePatientIds } from './accessible-patients.util.js';
import { ListPatientVisitsQueryDto } from './dto/list-patient-visits.query.dto.js';
import { PatientVisitItemDto } from './dto/patient-visit.dto.js';

/** Prisma `include` for a patient-portal visit-history row. */
const patientVisitInclude = {
  assigned_doctor: {
    select: { user: { select: { first_name: true, last_name: true } } },
  },
  branch: { select: { name: true } },
  episode: {
    select: {
      journey: { select: { organization: { select: { name: true } } } },
    },
  },
  diagnoses: {
    where: { is_deleted: false },
    orderBy: [{ is_primary: 'desc' }, { order: 'asc' }],
    select: { code: true, description: true, is_primary: true },
  },
  prescription: {
    include: {
      items: {
        where: { is_deleted: false },
        orderBy: { order: 'asc' },
        include: { medication: { select: { name: true } } },
      },
    },
  },
  investigations: {
    where: { is_deleted: false },
    orderBy: { created_at: 'asc' },
    include: { lab_test: { select: { name: true } } },
  },
} satisfies Prisma.VisitInclude;

type PatientVisitRow = Prisma.VisitGetPayload<{
  include: typeof patientVisitInclude;
}>;

@Injectable()
export class PatientVisitsService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Lists the caller's COMPLETED visits (newest first), each enriched with the
   * treating doctor, organization, branch, structured diagnoses, prescribed
   * medications, and ordered investigations. Cross-org (traverses the patient's
   * journeys) and scoped to the patients the caller may access.
   */
  async listVisits(
    ctx: PatientAuthContext,
    query: ListPatientVisitsQueryDto,
  ): Promise<PaginatedPayload<PatientVisitItemDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const targetIds = resolveAccessiblePatientIds(ctx, query.patient_id);
    if (targetIds.length === 0) {
      return paginated<PatientVisitItemDto>([], { page, limit, total: 0 });
    }

    const where: Prisma.VisitWhereInput = {
      is_deleted: false,
      status: 'COMPLETED',
      episode: { journey: { patient_id: { in: targetIds } } },
    };

    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visit.findMany({
        where,
        orderBy: { completed_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: patientVisitInclude,
      }),
      this.prismaService.db.visit.count({ where }),
    ]);

    const items = visits.map((v) => this.toDto(v));
    return paginated(items, { page, limit, total });
  }

  private toDto(v: PatientVisitRow): PatientVisitItemDto {
    const doctor = v.assigned_doctor?.user ?? null;

    return {
      id: v.id,
      visit_date: v.scheduled_at,
      completed_at: v.completed_at!,
      appointment_type: v.appointment_type,
      priority: v.priority,
      status: v.status,
      specialty_code: v.specialty_code ?? null,
      doctor_name: doctor
        ? `Dr. ${doctor.first_name} ${doctor.last_name}`.trim()
        : null,
      organization_name: v.episode?.journey?.organization?.name ?? null,
      branch_name: v.branch?.name ?? null,
      diagnoses: (v.diagnoses ?? []).map((d) => ({
        code: d.code,
        description: d.description,
        is_primary: d.is_primary,
      })),
      medications: (v.prescription?.items ?? []).map((item) => ({
        name: item.medication?.name ?? item.custom_drug_name ?? '',
        dose: item.dose,
        frequency: item.frequency,
        route: item.route ?? null,
        duration: item.duration ?? null,
        instructions: item.instructions ?? null,
      })),
      investigations: (v.investigations ?? [])
        .map((inv) => ({
          name: inv.lab_test?.name ?? inv.custom_test_name ?? '',
          status: inv.status,
        }))
        .filter((inv) => inv.name),
    };
  }
}
