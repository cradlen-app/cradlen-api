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

const IDENTITY_FIELDS = [
  'full_name',
  'national_id',
  'phone_number',
  'email',
  'company_name',
] as const;

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

function todayBounds(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

const MED_REP_VISIT_INCLUDE = {
  medical_rep: true,
  medications: true,
} as const;

@Injectable()
export class MedicalRepService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  async searchReps(
    user: AuthContext,
    query: { search?: string; page?: number; limit?: number },
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.MedicalRepWhereInput = {
      organization_id: user.organizationId,
      is_deleted: false,
      ...(query.search
        ? {
            OR: [
              { full_name: { contains: query.search, mode: 'insensitive' } },
              { national_id: { contains: query.search, mode: 'insensitive' } },
              { phone_number: { contains: query.search, mode: 'insensitive' } },
              { company_name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [reps, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.medicalRep.findMany({
        where,
        orderBy: [{ company_name: 'asc' }, { full_name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          full_name: true,
          national_id: true,
          phone_number: true,
          company_name: true,
        },
      }),
      this.prismaService.db.medicalRep.count({ where }),
    ]);
    return paginated(reps, { page, limit, total });
  }

  async findOne(id: string, user: AuthContext) {
    const rep = await this.prismaService.db.medicalRep.findFirst({
      where: { id, organization_id: user.organizationId, is_deleted: false },
    });
    if (!rep) throw new NotFoundException(`Medical rep ${id} not found`);
    return rep;
  }

  async bookVisit(dto: BookMedicalRepVisitDto, user: AuthContext) {
    const branchId = dto.branch_id ?? user.activeBranchId;
    if (!branchId) {
      throw new BadRequestException('branch_id is required');
    }
    await this.assertBranchInOrg(branchId, user.organizationId);

    const hasIdentityField = IDENTITY_FIELDS.some(
      (f) => dto[f] !== undefined && dto[f] !== null,
    );
    if (dto.medical_rep_id && hasIdentityField) {
      throw new BadRequestException(
        'When medical_rep_id is supplied, identity fields (full_name, national_id, phone_number, email, company_name) must be omitted',
      );
    }
    if (!dto.medical_rep_id && (!dto.full_name || !dto.company_name)) {
      throw new BadRequestException(
        'Either medical_rep_id or both full_name and company_name must be provided',
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
        await this.assertMedicationsExist(
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
        include: { medications: true },
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
    query: { page?: number; limit?: number; branch_id?: string },
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.MedicalRepVisitWhereInput = {
      organization_id: user.organizationId,
      is_deleted: false,
      ...(query.branch_id ? { branch_id: query.branch_id } : {}),
    };
    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.medicalRepVisit.findMany({
        where,
        orderBy: { scheduled_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { medical_rep: true, medications: true },
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
      include: { medical_rep: true, medications: true },
    });
    if (!visit)
      throw new NotFoundException(`Medical rep visit ${id} not found`);
    return visit;
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
    if (dto.national_id) {
      const existing = await tx.medicalRep.findFirst({
        where: {
          organization_id: organizationId,
          national_id: dto.national_id,
          is_deleted: false,
        },
      });
      if (existing) return existing;
    }
    return tx.medicalRep.create({
      data: {
        organization_id: organizationId,
        full_name: dto.full_name!,
        national_id: dto.national_id ?? null,
        phone_number: dto.phone_number ?? null,
        email: dto.email ?? null,
        company_name: dto.company_name!,
      },
    });
  }

  private async assertMedicationsExist(
    tx: Prisma.TransactionClient,
    ids: string[],
    organizationId: string,
  ) {
    const found = await tx.medication.findMany({
      where: {
        id: { in: ids },
        is_deleted: false,
        OR: [{ organization_id: null }, { organization_id: organizationId }],
      },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      const foundSet = new Set(found.map((m) => m.id));
      const missing = ids.filter((id) => !foundSet.has(id));
      throw new BadRequestException(
        `Unknown or cross-org medication_ids: ${missing.join(', ')}`,
      );
    }
  }

  async findBranchWaitingList(
    branchId: string,
    query: { page?: number; limit?: number },
    user: AuthContext,
  ) {
    await this.assertBranchInOrg(branchId, user.organizationId);
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
    query: { page?: number; limit?: number },
    user: AuthContext,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { start, end } = todayBounds();
    const where: Prisma.MedicalRepVisitWhereInput = {
      organization_id: user.organizationId,
      assigned_doctor_id: user.profileId,
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

  async findMyCurrent(user: AuthContext) {
    const visit = await this.prismaService.db.medicalRepVisit.findFirst({
      where: {
        organization_id: user.organizationId,
        assigned_doctor_id: user.profileId,
        status: 'IN_PROGRESS',
        is_deleted: false,
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
    if (dto.branch_id) {
      await this.assertBranchInOrg(dto.branch_id, user.organizationId);
    }

    const updated = await this.prismaService.db.$transaction(async (tx) => {
      if (dto.medication_ids) {
        await this.assertMedicationsExist(
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
    const allowedNext = MED_REP_TRANSITIONS[visit.status];
    if (!allowedNext.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition medical-rep visit from ${visit.status} to ${dto.status}`,
      );
    }
    const timestampField = MED_REP_STATUS_TIMESTAMPS[dto.status];
    const now = new Date();
    const updated = await this.prismaService.db.medicalRepVisit.update({
      where: { id },
      data: {
        status: dto.status,
        ...(timestampField ? { [timestampField]: now } : {}),
      },
      include: MED_REP_VISIT_INCLUDE,
    });
    this.eventBus.publish('medical_rep_visit.status_updated', {
      organizationId: user.organizationId,
      branchId: updated.branch_id,
      assignedDoctorId: updated.assigned_doctor_id,
      payload: updated,
    });
    return updated;
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
    return visit;
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
