import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.service.js';
import {
  CLINICAL_EVENTS,
  type InvestigationReviewedEvent,
} from '@core/clinical/events/events.public.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import type { PaginatedPayload } from '@common/dto/api-response.dto.js';
import { paginated } from '@common/utils/pagination.utils.js';
import {
  InvestigationAttachmentsItemDto,
  InvestigationReviewDto,
  ReviewInvestigationDto,
} from './dto/investigation-review.dto.js';
import { ListInvestigationsQueryDto } from './dto/list-investigations.query.dto.js';

/** Prisma `include`/`select` for the doctor review view of an investigation. */
const investigationReviewSelect = {
  id: true,
  status: true,
  test_category: true,
  custom_test_name: true,
  notes: true,
  result_text: true,
  updated_at: true,
  visit_id: true,
  lab_test: { select: { name: true } },
  visit: {
    select: {
      episode: {
        select: {
          journey: {
            select: {
              organization_id: true,
              patient: { select: { id: true, full_name: true } },
            },
          },
        },
      },
    },
  },
  result_attachments: {
    where: { is_deleted: false },
    orderBy: { created_at: 'asc' },
    select: { id: true, object_key: true, content_type: true },
  },
} satisfies Prisma.VisitInvestigationSelect;

type InvestigationReviewRow = Prisma.VisitInvestigationGetPayload<{
  select: typeof investigationReviewSelect;
}>;

/** Prisma `select` for one row of the patient attachments list. */
const investigationAttachmentsSelect = {
  id: true,
  status: true,
  test_category: true,
  custom_test_name: true,
  ordered_at: true,
  visit_id: true,
  lab_test: { select: { name: true } },
  visit: { select: { scheduled_at: true } },
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
} satisfies Prisma.VisitInvestigationSelect;

type InvestigationAttachmentsRow = Prisma.VisitInvestigationGetPayload<{
  select: typeof investigationAttachmentsSelect;
}>;

/**
 * Doctor-side investigation review: load a single investigation (with the
 * patient-uploaded result files, presigned) and record the doctor's review
 * (mark REVIEWED + notes). Org-gated via `PatientAccessService.assertVisitInOrg`.
 */
@Injectable()
export class InvestigationsService {
  private readonly logger = new Logger(InvestigationsService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
    private readonly patientAccess: PatientAccessService,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Lists a patient's investigations that carry result files, newest first,
   * for the visit-workspace Overview "Attachments" section. Branch-gated record
   * read (`assertPatientAccessible`) plus an org scope on the query. Clinic
   * users see every non-deleted attachment (no REVIEWED gate). Cancelled orders
   * are hidden unless explicitly requested.
   */
  async listForPatient(
    query: ListInvestigationsQueryDto,
    user: AuthContext,
  ): Promise<PaginatedPayload<InvestigationAttachmentsItemDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    await this.patientAccess.assertPatientAccessible(query.patient_id, user);

    const where: Prisma.VisitInvestigationWhereInput = {
      is_deleted: false,
      status: query.status ?? { not: 'CANCELLED' },
      ...(query.type ? { test_category: query.type } : {}),
      // Attachments section: only investigations that actually have files.
      result_attachments: { some: { is_deleted: false } },
      visit: {
        is_deleted: false,
        episode: {
          journey: {
            patient_id: query.patient_id,
            organization_id: user.organizationId,
          },
        },
      },
    };

    const [rows, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visitInvestigation.findMany({
        where,
        orderBy: { ordered_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: investigationAttachmentsSelect,
      }),
      this.prismaService.db.visitInvestigation.count({ where }),
    ]);

    const items = await Promise.all(rows.map((row) => this.toListItem(row)));
    return paginated(items, { page, limit, total });
  }

  private async toListItem(
    inv: InvestigationAttachmentsRow,
  ): Promise<InvestigationAttachmentsItemDto> {
    const result_attachments = await Promise.all(
      inv.result_attachments.map(async (a) => ({
        id: a.id,
        url: await this.storageService.createPresignedDownloadUrl(a.object_key),
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
      visit_id: inv.visit_id,
      visit_date: inv.visit.scheduled_at,
      result_attachments,
    };
  }

  async getReview(
    id: string,
    user: AuthContext,
  ): Promise<InvestigationReviewDto> {
    const investigation =
      await this.prismaService.db.visitInvestigation.findFirst({
        where: { id, is_deleted: false },
        select: investigationReviewSelect,
      });
    if (!investigation) {
      throw new NotFoundException('Investigation not found');
    }
    await this.patientAccess.assertVisitInOrg(investigation.visit_id, user);

    return this.toDto(investigation);
  }

  async review(
    id: string,
    user: AuthContext,
    dto: ReviewInvestigationDto,
  ): Promise<InvestigationReviewDto> {
    const existing = await this.prismaService.db.visitInvestigation.findFirst({
      where: { id, is_deleted: false },
      select: { id: true, visit_id: true, status: true },
    });
    if (!existing) {
      throw new NotFoundException('Investigation not found');
    }
    await this.patientAccess.assertVisitInOrg(existing.visit_id, user);

    const updated = await this.prismaService.db.visitInvestigation.update({
      where: { id },
      data: {
        status: 'REVIEWED',
        reviewed_by_id: user.profileId,
        reviewed_at: new Date(),
        result_text: dto.notes ?? null,
        version: { increment: 1 },
      },
      select: investigationReviewSelect,
    });

    // Notify the patient once, on the transition into REVIEWED (re-saving notes
    // on an already-reviewed row doesn't re-notify). Best-effort.
    if (existing.status !== 'REVIEWED') {
      this.publishReviewed(id, updated);
    }

    return this.toDto(updated);
  }

  /** Publishes `investigation.reviewed` for the patient "result ready" notification. */
  private publishReviewed(id: string, inv: InvestigationReviewRow): void {
    try {
      const journey = inv.visit.episode?.journey;
      if (!journey) return;
      this.eventBus.publish<InvestigationReviewedEvent>(
        CLINICAL_EVENTS.investigation.reviewed,
        {
          investigation_id: id,
          visit_id: inv.visit_id,
          patient_id: journey.patient.id,
          organization_id: journey.organization_id,
          test_name: inv.lab_test?.name ?? inv.custom_test_name ?? 'your test',
        },
      );
    } catch (err) {
      this.logger.warn(
        `Failed to publish investigation.reviewed (id=${id}): ${String(err)}`,
      );
    }
  }

  private async toDto(
    inv: InvestigationReviewRow,
  ): Promise<InvestigationReviewDto> {
    const result_attachments = await Promise.all(
      inv.result_attachments.map(async (a) => ({
        id: a.id,
        url: await this.storageService.createPresignedDownloadUrl(a.object_key),
        content_type: a.content_type ?? null,
      })),
    );

    return {
      id: inv.id,
      patient_name: inv.visit.episode?.journey?.patient?.full_name ?? '',
      visit_id: inv.visit_id,
      status: inv.status,
      type: inv.test_category ?? null,
      test_name: inv.lab_test?.name ?? inv.custom_test_name ?? '',
      reason: inv.notes ?? null,
      updated_at: inv.updated_at,
      doctor_notes: inv.result_text ?? null,
      result_attachments,
    };
  }
}
