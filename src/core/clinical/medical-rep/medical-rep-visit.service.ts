import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MedicalRepVisitStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { paginated } from '@common/utils/pagination.utils';
import { BookMedicalRepVisitDto } from './dto/book-medical-rep-visit.dto';
import { UpdateMedicalRepVisitDto } from './dto/update-medical-rep-visit.dto';
import { UpdateMedicalRepVisitStatusDto } from './dto/update-medical-rep-visit-status.dto';
import { TemplateValidator } from '@builder/validator/template.validator.js';
import { TemplatesService } from '@builder/templates/templates.service.js';
import { todayBounds } from '@common/utils/date-range.utils.js';
import { assertStatusTransition } from '@common/utils/state-transition.js';
import { assertBookVisitPayloadValid } from '../shared/book-visit-validation.js';
import { nextQueueNumber } from '../shared/queue-number.js';
import { assertMedicationsExistInOrg } from './medical-rep.helpers.js';

const MED_REP_TERMINAL: MedicalRepVisitStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
];

const MED_REP_TRANSITIONS: Record<
  MedicalRepVisitStatus,
  MedicalRepVisitStatus[]
> = {
  SCHEDULED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const MED_REP_STATUS_TIMESTAMPS: Partial<
  Record<MedicalRepVisitStatus, 'checked_in_at' | 'started_at' | 'completed_at'>
> = {
  CHECKED_IN: 'checked_in_at',
  IN_PROGRESS: 'started_at',
  COMPLETED: 'completed_at',
};

const MED_REP_VISIT_INCLUDE = {
  medical_rep: true,
  medications: true,
  assigned_doctor: {
    select: {
      id: true,
      user: { select: { id: true, first_name: true, last_name: true } },
    },
  },
} as const;

/**
 * Lifecycle of medical-rep visits: booking, listing/queues, and the
 * status/edit transitions. Rep identity and rep-medication catalog management
 * live in `MedicalRepService`.
 */
@Injectable()
export class MedicalRepVisitService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventBus: EventBus,
    private readonly templateValidator: TemplateValidator,
    private readonly templatesService: TemplatesService,
  ) {}

  private assertTemplateValid(
    payload: Record<string, unknown>,
    sparse: boolean,
  ) {
    return assertBookVisitPayloadValid(this.templateValidator, payload, {
      sparse,
    });
  }

  async bookVisit(dto: BookMedicalRepVisitDto, user: AuthContext) {
    await this.assertTemplateValid(
      dto as unknown as Record<string, unknown>,
      false,
    );
    const bookVisitTemplate =
      await this.templatesService.findActiveByCode('book_visit');
    const branchId = dto.branch_id ?? user.activeBranchId;
    if (!branchId) {
      throw new BadRequestException('branch_id is required');
    }
    await this.assertBranchInOrg(branchId, user.organizationId);
    this.assertBranchAccess(branchId, user);

    // `medical_rep_id` wins: when an existing rep is selected, identity fields
    // are ignored (loadExistingRep loads the rep by id and never reads them),
    // so a stray identity field on the payload no longer rejects the booking.
    if (!dto.medical_rep_id && (!dto.rep_full_name || !dto.company_name)) {
      throw new BadRequestException(
        'Either medical_rep_id or both rep_full_name and company_name must be provided',
      );
    }

    const result = await this.prismaService.db.$transaction(async (tx) => {
      const rep = dto.medical_rep_id
        ? await this.loadExistingRep(
            tx,
            dto.medical_rep_id,
            user.organizationId,
          )
        : await this.upsertNewRep(tx, dto, user.organizationId);

      if (dto.medication_ids && dto.medication_ids.length) {
        await assertMedicationsExistInOrg(
          tx,
          dto.medication_ids,
          user.organizationId,
        );
      }

      const visit = await tx.medicalRepVisit.create({
        data: {
          medical_rep_id: rep.id,
          organization_id: user.organizationId,
          branch_id: branchId,
          assigned_doctor_id: dto.assigned_doctor_id,
          created_by_id: user.profileId,
          scheduled_at: new Date(dto.scheduled_at),
          priority: dto.priority ?? 'NORMAL',
          notes: dto.notes ?? null,
          form_template_id: bookVisitTemplate.id,
          medications: dto.medication_ids?.length
            ? {
                createMany: {
                  data: dto.medication_ids.map((mid) => ({
                    medication_id: mid,
                  })),
                },
              }
            : undefined,
        },
        include: MED_REP_VISIT_INCLUDE,
      });
      return { rep, visit };
    });

    this.eventBus.publish('medical_rep_visit.booked', {
      organizationId: user.organizationId,
      branchId,
      assignedDoctorId: dto.assigned_doctor_id,
      visitId: result.visit.id,
      medicalRepId: result.rep.id,
    });
    return result;
  }

  async listVisits(
    user: AuthContext,
    query: {
      page?: number;
      limit?: number;
      branch_id?: string;
      medical_rep_id?: string;
    },
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    // OWNER sees the org-wide overview; an explicit branch_id narrows it.
    // Non-owners are confined to their assigned branches: a supplied branch_id
    // must be one they can reach, otherwise the list is scoped to all of them.
    const isOwner = user.roles.includes('OWNER');
    let branchFilter: Prisma.MedicalRepVisitWhereInput;
    if (isOwner) {
      branchFilter = query.branch_id ? { branch_id: query.branch_id } : {};
    } else if (query.branch_id) {
      this.assertBranchAccess(query.branch_id, user);
      branchFilter = { branch_id: query.branch_id };
    } else {
      branchFilter = { branch_id: { in: user.branchIds } };
    }
    const where: Prisma.MedicalRepVisitWhereInput = {
      organization_id: user.organizationId,
      is_deleted: false,
      ...branchFilter,
      ...(query.medical_rep_id ? { medical_rep_id: query.medical_rep_id } : {}),
    };
    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.medicalRepVisit.findMany({
        where,
        orderBy: { scheduled_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: MED_REP_VISIT_INCLUDE,
      }),
      this.prismaService.db.medicalRepVisit.count({ where }),
    ]);
    return paginated(visits, { page, limit, total });
  }

  async findVisit(id: string, user: AuthContext) {
    const visit = await this.prismaService.db.medicalRepVisit.findFirst({
      where: {
        id,
        organization_id: user.organizationId,
        is_deleted: false,
      },
      include: MED_REP_VISIT_INCLUDE,
    });
    if (!visit)
      throw new NotFoundException(`Medical rep visit ${id} not found`);
    this.assertBranchAccess(visit.branch_id, user);
    return visit;
  }

  /**
   * Past visits for the same rep as `visitId`, most recent first — backs the
   * Overview "Visits History" timeline. Only COMPLETED visits (a true history),
   * excluding the visit being viewed. Includes product names per visit.
   */
  async listVisitHistory(
    visitId: string,
    query: { page?: number; limit?: number },
    user: AuthContext,
  ) {
    const current = await this.loadVisitForUser(visitId, user);
    return this.queryCompletedVisitHistory(
      {
        organization_id: user.organizationId,
        medical_rep_id: current.medical_rep_id,
        id: { not: visitId },
        status: 'COMPLETED',
        is_deleted: false,
        ...this.historyBranchFilter(user),
      },
      query,
    );
  }

  /**
   * All COMPLETED visits for a rep, most recent first — backs the standalone
   * rep overview page's "Visits History" timeline (rep-scoped, not tied to a
   * single visit). Includes product names per visit.
   */
  async listRepVisitHistory(
    repId: string,
    query: { page?: number; limit?: number },
    user: AuthContext,
  ) {
    return this.queryCompletedVisitHistory(
      {
        organization_id: user.organizationId,
        medical_rep_id: repId,
        status: 'COMPLETED',
        is_deleted: false,
        ...this.historyBranchFilter(user),
      },
      query,
    );
  }

  /** Shared paginated query + rich mapping for the visit-history timelines. */
  private async queryCompletedVisitHistory(
    where: Prisma.MedicalRepVisitWhereInput,
    query: { page?: number; limit?: number },
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 3;
    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.medicalRepVisit.findMany({
        where,
        orderBy: { scheduled_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          medications: {
            include: { medication: { select: { id: true, name: true } } },
          },
        },
      }),
      this.prismaService.db.medicalRepVisit.count({ where }),
    ]);
    const items = visits.map((v) => ({
      id: v.id,
      scheduled_at: v.scheduled_at.toISOString(),
      completed_at: v.completed_at?.toISOString() ?? null,
      status: v.status,
      purpose: v.purpose,
      outcome: v.outcome,
      samples_received: v.samples_received,
      follow_up_date: v.follow_up_date?.toISOString() ?? null,
      notes: v.notes,
      products: v.medications.map((m) => ({
        id: m.medication.id,
        name: m.medication.name,
      })),
    }));
    return paginated(items, { page, limit, total });
  }

  async findBranchWaitingList(
    branchId: string,
    query: { page?: number; limit?: number },
    user: AuthContext,
  ) {
    await this.assertBranchInOrg(branchId, user.organizationId);
    this.assertBranchAccess(branchId, user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { start, end } = todayBounds();
    const where: Prisma.MedicalRepVisitWhereInput = {
      organization_id: user.organizationId,
      branch_id: branchId,
      is_deleted: false,
      status: { in: ['SCHEDULED', 'CHECKED_IN'] },
      scheduled_at: { gte: start, lte: end },
    };
    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.medicalRepVisit.findMany({
        where,
        orderBy: [{ status: 'asc' }, { scheduled_at: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: MED_REP_VISIT_INCLUDE,
      }),
      this.prismaService.db.medicalRepVisit.count({ where }),
    ]);
    return paginated(visits, { page, limit, total });
  }

  async findBranchInProgress(
    branchId: string,
    query: { page?: number; limit?: number },
    user: AuthContext,
  ) {
    await this.assertBranchInOrg(branchId, user.organizationId);
    this.assertBranchAccess(branchId, user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { start, end } = todayBounds();
    const where: Prisma.MedicalRepVisitWhereInput = {
      organization_id: user.organizationId,
      branch_id: branchId,
      is_deleted: false,
      status: 'IN_PROGRESS',
      started_at: { gte: start, lte: end },
    };
    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.medicalRepVisit.findMany({
        where,
        orderBy: { started_at: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: MED_REP_VISIT_INCLUDE,
      }),
      this.prismaService.db.medicalRepVisit.count({ where }),
    ]);
    return paginated(visits, { page, limit, total });
  }

  async findMyWaitingList(
    branchId: string,
    query: { page?: number; limit?: number },
    user: AuthContext,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { start, end } = todayBounds();
    const where: Prisma.MedicalRepVisitWhereInput = {
      organization_id: user.organizationId,
      assigned_doctor_id: user.profileId,
      branch_id: branchId,
      is_deleted: false,
      status: { in: ['SCHEDULED', 'CHECKED_IN'] },
      scheduled_at: { gte: start, lte: end },
    };
    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.medicalRepVisit.findMany({
        where,
        orderBy: [{ status: 'asc' }, { scheduled_at: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: MED_REP_VISIT_INCLUDE,
      }),
      this.prismaService.db.medicalRepVisit.count({ where }),
    ]);
    return paginated(visits, { page, limit, total });
  }

  async findMyCurrent(branchId: string, user: AuthContext) {
    // Bound to visits started TODAY — mirrors VisitsService.findMyCurrent so a
    // rep visit started on a prior day (and never completed) doesn't linger as
    // the doctor's "current visit" indefinitely.
    const { start, end } = todayBounds();
    const visit = await this.prismaService.db.medicalRepVisit.findFirst({
      where: {
        organization_id: user.organizationId,
        assigned_doctor_id: user.profileId,
        branch_id: branchId,
        status: 'IN_PROGRESS',
        is_deleted: false,
        started_at: { gte: start, lte: end },
      },
      orderBy: { started_at: 'desc' },
      include: MED_REP_VISIT_INCLUDE,
    });
    return { data: visit };
  }

  async updateVisit(
    id: string,
    dto: UpdateMedicalRepVisitDto,
    user: AuthContext,
  ) {
    const visit = await this.loadVisitForUser(id, user);
    if (MED_REP_TERMINAL.includes(visit.status)) {
      throw new BadRequestException(
        `Cannot update a medical-rep visit in terminal status: ${visit.status}`,
      );
    }
    // UpdateMedicalRepVisitDto has no visitor_type field — the discriminator
    // is implicit in the endpoint identity. Inject it so the validator can
    // enforce visitor_type-keyed forbidden predicates against cross-namespace
    // leaks in the patch.
    await this.assertTemplateValid(
      {
        ...(dto as unknown as Record<string, unknown>),
        visitor_type: 'MEDICAL_REP',
      },
      true,
    );
    if (dto.branch_id) {
      await this.assertBranchInOrg(dto.branch_id, user.organizationId);
    }

    const updated = await this.prismaService.db.$transaction(async (tx) => {
      const repUpdates: Prisma.MedicalRepUpdateInput = {
        ...(dto.rep_full_name !== undefined && {
          full_name: dto.rep_full_name,
        }),
        ...(dto.rep_national_id !== undefined && {
          national_id: dto.rep_national_id,
        }),
        ...(dto.rep_phone_number !== undefined && {
          phone_number: dto.rep_phone_number,
        }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.company_name !== undefined && {
          company_name: dto.company_name,
        }),
        ...(dto.specialty_focus !== undefined && {
          specialty_focus: dto.specialty_focus,
        }),
      };
      if (Object.keys(repUpdates).length > 0) {
        await tx.medicalRep.update({
          where: { id: visit.medical_rep_id },
          data: repUpdates,
        });
      }

      if (dto.medication_ids) {
        await assertMedicationsExistInOrg(
          tx,
          dto.medication_ids,
          user.organizationId,
        );
        await tx.medicalRepVisitMedication.deleteMany({
          where: { medical_rep_visit_id: id },
        });
        if (dto.medication_ids.length) {
          await tx.medicalRepVisitMedication.createMany({
            data: dto.medication_ids.map((mid) => ({
              medical_rep_visit_id: id,
              medication_id: mid,
            })),
          });
        }
      }
      return tx.medicalRepVisit.update({
        where: { id },
        data: {
          ...(dto.assigned_doctor_id !== undefined && {
            assigned_doctor_id: dto.assigned_doctor_id,
          }),
          ...(dto.branch_id !== undefined && { branch_id: dto.branch_id }),
          ...(dto.scheduled_at !== undefined && {
            scheduled_at: new Date(dto.scheduled_at),
          }),
          ...(dto.priority !== undefined && { priority: dto.priority }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
        include: MED_REP_VISIT_INCLUDE,
      });
    });

    this.eventBus.publish('medical_rep_visit.updated', {
      organizationId: user.organizationId,
      branchId: updated.branch_id,
      assignedDoctorId: updated.assigned_doctor_id,
      payload: updated,
    });
    return updated;
  }

  async updateVisitStatus(
    id: string,
    dto: UpdateMedicalRepVisitStatusDto,
    user: AuthContext,
  ) {
    const visit = await this.loadVisitForUser(id, user);
    assertStatusTransition(
      MED_REP_TRANSITIONS,
      visit.status,
      dto.status,
      (current, next) =>
        `Cannot transition medical-rep visit from ${current} to ${next}`,
    );
    const timestampField = MED_REP_STATUS_TIMESTAMPS[dto.status];
    const now = new Date();

    // Compute the queue number inside the same transaction that writes it, so
    // two concurrent check-ins can't read the same max and collide.
    const updated = await this.prismaService.db.$transaction(async (tx) => {
      const queueNumber =
        dto.status === 'CHECKED_IN'
          ? await this.getNextRepQueueNumber(
              tx,
              visit.assigned_doctor_id,
              visit.branch_id,
              now,
            )
          : undefined;

      return tx.medicalRepVisit.update({
        where: { id },
        data: {
          status: dto.status,
          ...(timestampField ? { [timestampField]: now } : {}),
          ...(queueNumber !== undefined ? { queue_number: queueNumber } : {}),
        },
        include: MED_REP_VISIT_INCLUDE,
      });
    });
    this.eventBus.publish('medical_rep_visit.status_updated', {
      organizationId: user.organizationId,
      branchId: updated.branch_id,
      assignedDoctorId: updated.assigned_doctor_id,
      payload: updated,
    });
    return updated;
  }

  private async loadExistingRep(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const rep = await tx.medicalRep.findFirst({
      where: { id, organization_id: organizationId, is_deleted: false },
    });
    if (!rep) throw new NotFoundException(`Medical rep ${id} not found`);
    return rep;
  }

  private async upsertNewRep(
    tx: Prisma.TransactionClient,
    dto: BookMedicalRepVisitDto,
    organizationId: string,
  ) {
    if (dto.rep_national_id) {
      const existing = await tx.medicalRep.findFirst({
        where: {
          organization_id: organizationId,
          national_id: dto.rep_national_id,
          is_deleted: false,
        },
      });
      if (existing) return existing;
    }
    return tx.medicalRep.create({
      data: {
        organization_id: organizationId,
        full_name: dto.rep_full_name!,
        national_id: dto.rep_national_id ?? null,
        phone_number: dto.rep_phone_number ?? null,
        email: dto.email ?? null,
        company_name: dto.company_name!,
        specialty_focus: dto.specialty_focus ?? null,
      },
    });
  }

  private getNextRepQueueNumber(
    tx: Prisma.TransactionClient,
    assignedDoctorId: string,
    branchId: string,
    date: Date,
  ): Promise<number> {
    return nextQueueNumber(date, ({ start, end }) =>
      tx.medicalRepVisit.findFirst({
        where: {
          assigned_doctor_id: assignedDoctorId,
          branch_id: branchId,
          checked_in_at: { gte: start, lte: end },
          is_deleted: false,
        },
        orderBy: { queue_number: 'desc' },
        select: { queue_number: true },
      }),
    );
  }

  private async loadVisitForUser(id: string, user: AuthContext) {
    const visit = await this.prismaService.db.medicalRepVisit.findFirst({
      where: {
        id,
        organization_id: user.organizationId,
        is_deleted: false,
      },
    });
    if (!visit)
      throw new NotFoundException(`Medical rep visit ${id} not found`);
    this.assertBranchAccess(visit.branch_id, user);
    return visit;
  }

  /**
   * Branch-level access gate. OWNER reaches every branch; everyone else only
   * the branches they're assigned to (`AuthContext.branchIds`). Mirrors the
   * in-memory check used by `VisitsService` — no extra DB round-trip.
   */
  private assertBranchAccess(branchId: string, user: AuthContext) {
    if (!user.roles.includes('OWNER') && !user.branchIds.includes(branchId)) {
      throw new ForbiddenException('Branch access denied');
    }
  }

  /**
   * Branch constraint for the rep visit-history timelines. OWNER sees the rep's
   * visits across every branch; non-owners only the rep's visits at branches
   * they're assigned to. The rep profile/products stay org-wide either way.
   */
  private historyBranchFilter(
    user: AuthContext,
  ): Prisma.MedicalRepVisitWhereInput {
    return user.roles.includes('OWNER')
      ? {}
      : { branch_id: { in: user.branchIds } };
  }

  private async assertBranchInOrg(branchId: string, organizationId: string) {
    const branch = await this.prismaService.db.branch.findFirst({
      where: {
        id: branchId,
        organization_id: organizationId,
        is_deleted: false,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (!branch) {
      throw new ForbiddenException(
        `Branch ${branchId} not found in your organization`,
      );
    }
  }
}
