import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import type { PaginatedPayload } from '@common/dto/api-response.dto.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { resolveAccessiblePatientIds } from '../accessible-patients.util.js';
import { ListPatientVisitsQueryDto } from './dto/list-patient-visits.query.dto.js';
import { PatientVisitItemDto } from './dto/patient-visit.dto.js';
import { PatientUpcomingVisitItemDto } from './dto/patient-upcoming-visit.dto.js';
import { PatientJourneyTimelineDto } from './dto/patient-journey-timeline.dto.js';

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

/** Lighter `include` for an upcoming follow-up row (no clinical sub-records). */
const upcomingVisitInclude = {
  assigned_doctor: {
    select: { user: { select: { first_name: true, last_name: true } } },
  },
  branch: { select: { name: true } },
  episode: {
    select: {
      journey: { select: { organization: { select: { name: true } } } },
    },
  },
} satisfies Prisma.VisitInclude;

type UpcomingVisitRow = Prisma.VisitGetPayload<{
  include: typeof upcomingVisitInclude;
}>;

/**
 * Prisma `include` for a patient journey tree: episodes (ordered) → completed
 * visits (newest first), each visit carrying the same rich relations as the
 * flat history (so `toDto` produces identical items).
 */
const journeyTimelineInclude = {
  journey_template: { select: { name: true, type: true } },
  episodes: {
    where: { is_deleted: false },
    orderBy: { order: 'asc' },
    include: {
      visits: {
        where: { is_deleted: false, status: 'COMPLETED' as const },
        orderBy: { completed_at: 'desc' },
        include: patientVisitInclude,
      },
    },
  },
} satisfies Prisma.PatientJourneyInclude;

type JourneyTimelineRow = Prisma.PatientJourneyGetPayload<{
  include: typeof journeyTimelineInclude;
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

  /**
   * Lists the caller's upcoming recommended follow-ups (soonest first). Each
   * item is derived from a COMPLETED visit carrying a future `follow_up_date`
   * (a "come back by date X" recommendation) — not from a separately booked
   * future appointment row. Past-due recommendations are excluded. Cross-org
   * and scoped to the patients the caller may access.
   */
  async listUpcoming(
    ctx: PatientAuthContext,
    query: ListPatientVisitsQueryDto,
  ): Promise<PaginatedPayload<PatientUpcomingVisitItemDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const targetIds = resolveAccessiblePatientIds(ctx, query.patient_id);
    if (targetIds.length === 0) {
      return paginated<PatientUpcomingVisitItemDto>([], {
        page,
        limit,
        total: 0,
      });
    }

    // Start of today (server/UTC) so a follow-up dated today still surfaces.
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const where: Prisma.VisitWhereInput = {
      is_deleted: false,
      status: 'COMPLETED',
      follow_up_date: { gte: startOfToday },
      episode: { journey: { patient_id: { in: targetIds } } },
    };

    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visit.findMany({
        where,
        orderBy: { follow_up_date: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: upcomingVisitInclude,
      }),
      this.prismaService.db.visit.count({ where }),
    ]);

    const items = visits.map((v) => this.toUpcomingDto(v));
    return paginated(items, { page, limit, total });
  }

  /**
   * Lists the caller's care as a Journey → Episode → Visit tree (journeys newest
   * first), each episode carrying its COMPLETED visits (newest first). Paginated
   * **by journey** so a group never splits across pages. Cross-org (a patient's
   * journeys span organizations) and scoped to the patients the caller may
   * access. Each nested visit is the same rich item as the flat history.
   */
  async listJourneyTimeline(
    ctx: PatientAuthContext,
    query: ListPatientVisitsQueryDto,
  ): Promise<PaginatedPayload<PatientJourneyTimelineDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 5;

    const targetIds = resolveAccessiblePatientIds(ctx, query.patient_id);
    if (targetIds.length === 0) {
      return paginated<PatientJourneyTimelineDto>([], {
        page,
        limit,
        total: 0,
      });
    }

    const where: Prisma.PatientJourneyWhereInput = {
      is_deleted: false,
      patient_id: { in: targetIds },
    };

    const [journeys, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.patientJourney.findMany({
        where,
        orderBy: { started_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: journeyTimelineInclude,
      }),
      this.prismaService.db.patientJourney.count({ where }),
    ]);

    const items = journeys.map((j) => this.toTimelineDto(j));
    return paginated(items, { page, limit, total });
  }

  private toTimelineDto(j: JourneyTimelineRow): PatientJourneyTimelineDto {
    return {
      id: j.id,
      name: j.journey_template?.name ?? '',
      type: j.journey_template?.type ?? '',
      status: j.status,
      started_at: j.started_at,
      ended_at: j.ended_at,
      episodes: (j.episodes ?? []).map((e) => ({
        id: e.id,
        name: e.name,
        order: e.order,
        status: e.status,
        started_at: e.started_at,
        ended_at: e.ended_at,
        visits: e.visits.map((v) => this.toDto(v)),
      })),
    };
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

  private toUpcomingDto(v: UpcomingVisitRow): PatientUpcomingVisitItemDto {
    const doctor = v.assigned_doctor?.user ?? null;

    return {
      id: v.id,
      follow_up_date: v.follow_up_date!,
      follow_up_notes: v.follow_up_notes ?? null,
      source_visit_date: v.scheduled_at,
      specialty_code: v.specialty_code ?? null,
      doctor_name: doctor
        ? `Dr. ${doctor.first_name} ${doctor.last_name}`.trim()
        : null,
      organization_name: v.episode?.journey?.organization?.name ?? null,
      branch_name: v.branch?.name ?? null,
    };
  }
}
