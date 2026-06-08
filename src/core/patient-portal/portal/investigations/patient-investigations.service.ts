import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import type { PaginatedPayload } from '@common/dto/api-response.dto.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { resolveAccessiblePatientIds } from '../accessible-patients.util.js';
import { ListPatientInvestigationsQueryDto } from './dto/list-patient-investigations.query.dto.js';
import { PatientInvestigationItemDto } from './dto/patient-investigation.dto.js';

/** Prisma `include` for a patient-portal investigation row. */
export const patientInvestigationInclude = {
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
  result_attachments: {
    where: { is_deleted: false },
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      object_key: true,
      content_type: true,
      created_at: true,
      source: true,
    },
  },
} satisfies Prisma.VisitInvestigationInclude;

export type PatientInvestigationRow = Prisma.VisitInvestigationGetPayload<{
  include: typeof patientInvestigationInclude;
}>;

/**
 * Maps an investigation row to the patient-facing DTO. Result content is exposed
 * when the row is REVIEWED (clinic-published, clinically gated) OR was uploaded
 * by the patient themselves (`result_source = PATIENT`). Each visible attachment's
 * stored object key is converted to a short-lived presigned GET URL (the R2 bucket
 * is private) — patient-uploaded files are always visible to the patient; clinic
 * files only once REVIEWED. Async because signing the URLs is awaited.
 */
export async function mapPatientInvestigation(
  inv: PatientInvestigationRow,
  storage: StorageService,
): Promise<PatientInvestigationItemDto> {
  const reviewed = inv.status === 'REVIEWED';
  const showResult = reviewed || inv.result_source === 'PATIENT';
  const orderedBy = inv.ordered_by?.user ?? null;
  const reviewedBy = inv.reviewed_by?.user ?? null;

  const visibleAttachments = inv.result_attachments.filter(
    (a) => a.source === 'PATIENT' || reviewed,
  );
  const result_attachments = await Promise.all(
    visibleAttachments.map(async (a) => ({
      id: a.id,
      url: await storage.createPresignedDownloadUrl(a.object_key),
      content_type: a.content_type ?? null,
      uploaded_at: a.created_at,
      source: a.source,
    })),
  );

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
    result_text: showResult ? (inv.result_text ?? null) : null,
    result_attachments,
    visit_id: inv.visit_id,
    visit_date: inv.visit.scheduled_at,
    organization_name: inv.visit.episode?.journey?.organization?.name ?? null,
    branch_name: inv.visit.branch?.name ?? null,
  };
}

@Injectable()
export class PatientInvestigationsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Lists the caller's investigations (lab tests & imaging) across all visits,
   * newest first (by order date). Cancelled orders are hidden unless explicitly
   * requested via the status filter. Result content is withheld until a doctor
   * has REVIEWED the investigation (clinical-safety gate) — except results the
   * patient uploaded themselves, which are always visible to them. Cross-org
   * (traverses the patient's journeys) and scoped to the accessible patients.
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

    const items = await Promise.all(
      rows.map((row) => mapPatientInvestigation(row, this.storageService)),
    );
    return paginated(items, { page, limit, total });
  }
}
