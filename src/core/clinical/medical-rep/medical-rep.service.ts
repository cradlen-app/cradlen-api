import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { paginated } from '@common/utils/pagination.utils';
import { BookMedicalRepVisitDto } from './dto/book-medical-rep-visit.dto';

const IDENTITY_FIELDS = [
  'full_name',
  'national_id',
  'phone_number',
  'email',
  'company_name',
] as const;

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
