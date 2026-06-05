import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import type { PaginatedPayload } from '@common/dto/api-response.dto.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { resolveAccessiblePatientIds } from './accessible-patients.util.js';
import { ListPatientInvestigationsQueryDto } from './dto/list-patient-investigations.query.dto.js';
import { PatientInvestigationItemDto } from './dto/patient-investigation.dto.js';

/** Prisma `include` for a patient-portal investigation row. */
const patientInvestigationInclude = {
  lab_test: { select: { name: true } },
  ordered_by: {
    select: { user: { select: { first_name: true, last_name: true } } },
  },
  reviewed_by: {
    select: { user: { select: { first_name: true, last_name: true } } },
  },
  visit: {
    select: {
      id: true,
      scheduled_at: true,
      branch: { select: { name: true } },
      episode: {
        select: {
          journey: { select: { organization: { select: { name: true } } } },
        },
      },
    },
  },
} satisfies Prisma.VisitInvestigationInclude;

type PatientInvestigationRow = Prisma.VisitInvestigationGetPayload<{
  include: typeof patientInvestigationInclude;
}>;

@Injectable()
export class PatientInvestigationsService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Lists the caller's investigations (lab tests & imaging) across all visits,
   * newest first (by order date). Cancelled orders are hidden unless explicitly
   * requested via the status filter. Result content is withheld until a doctor
   * has REVIEWED the investigation (clinical-safety gate). Cross-org (traverses
   * the patient's journeys) and scoped to the patients the caller may access.
   */
  async listInvestigations(
    ctx: PatientAuthContext,
    query: ListPatientInvestigationsQueryDto,
  ): Promise<PaginatedPayload<PatientInvestigationItemDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const targetIds = resolveAccessiblePatientIds(ctx, query.patient_id);
    if (targetIds.length === 0) {
      return paginated<PatientInvestigationItemDto>([], {
        page,
        limit,
        total: 0,
      });
    }

    const where: Prisma.VisitInvestigationWhereInput = {
      is_deleted: false,
      // Hide cancelled orders by default; honour an explicit status filter.
      status: query.status ?? { not: 'CANCELLED' },
      ...(query.type ? { test_category: query.type } : {}),
      visit: {
        is_deleted: false,
        episode: { journey: { patient_id: { in: targetIds } } },
      },
    };

    const [rows, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visitInvestigation.findMany({
        where,
        orderBy: { ordered_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: patientInvestigationInclude,
      }),
      this.prismaService.db.visitInvestigation.count({ where }),
    ]);

    const items = rows.map((row) => this.toDto(row));
    return paginated(items, { page, limit, total });
  }

  private toDto(inv: PatientInvestigationRow): PatientInvestigationItemDto {
    const reviewed = inv.status === 'REVIEWED';
    const orderedBy = inv.ordered_by?.user ?? null;
    const reviewedBy = inv.reviewed_by?.user ?? null;

    return {
      id: inv.id,
      test_name: inv.lab_test?.name ?? inv.custom_test_name ?? '',
      type: inv.test_category ?? null,
      status: inv.status,
      ordered_at: inv.ordered_at,
      instructions: inv.notes ?? null,
      ordered_by_name: orderedBy
        ? `Dr. ${orderedBy.first_name} ${orderedBy.last_name}`.trim()
        : null,
      reviewed_at: inv.reviewed_at ?? null,
      reviewed_by_name:
        reviewed && reviewedBy
          ? `Dr. ${reviewedBy.first_name} ${reviewedBy.last_name}`.trim()
          : null,
      result_text: reviewed ? (inv.result_text ?? null) : null,
      result_attachment_url: reviewed
        ? (inv.result_attachment_url ?? null)
        : null,
      visit_id: inv.visit_id,
      visit_date: inv.visit.scheduled_at,
      organization_name: inv.visit.episode?.journey?.organization?.name ?? null,
      branch_name: inv.visit.branch?.name ?? null,
    };
  }
}
