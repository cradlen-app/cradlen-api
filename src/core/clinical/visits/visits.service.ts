import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VisitStatus } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { CreateVisitDto } from './dto/create-visit.dto';
import { UpdateVisitDto } from './dto/update-visit.dto';
import { UpdateVisitStatusDto } from './dto/update-visit-status.dto';
import { BookVisitDto } from './dto/book-visit.dto';
import { SetFollowUpDto } from './dto/set-follow-up.dto';
import { VisitIntakeFieldsDto } from './dto/visit-intake.dto';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { paginated } from '@common/utils/pagination.utils';

const TERMINAL_STATES: VisitStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW'];

const VALID_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  SCHEDULED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const STATUS_TIMESTAMPS: Partial<Record<VisitStatus, string>> = {
  CHECKED_IN: 'checked_in_at',
  IN_PROGRESS: 'started_at',
  COMPLETED: 'completed_at',
};

@Injectable()
export class VisitsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  private async getNextQueueNumber(
    tx: Prisma.TransactionClient,
    assignedDoctorId: string,
    branchId: string,
    date: Date,
  ): Promise<number> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const last = await tx.visit.findFirst({
      where: {
        assigned_doctor_id: assignedDoctorId,
        branch_id: branchId,
        checked_in_at: { gte: dayStart, lte: dayEnd },
        is_deleted: false,
      },
      orderBy: { queue_number: 'desc' },
      select: { queue_number: true },
    });

    return (last?.queue_number ?? 0) + 1;
  }

  private hasComplaintIntake(intake: VisitIntakeFieldsDto): boolean {
    return (
      intake.chief_complaint !== undefined ||
      intake.chief_complaint_meta !== undefined
    );
  }

  private hasVitalsIntake(intake: VisitIntakeFieldsDto): boolean {
    if (!intake.vitals) return false;
    return Object.values(intake.vitals).some((v) => v !== undefined);
  }

  private computeBmi(
    weight_kg: number | undefined,
    height_cm: number | undefined,
  ): number | null {
    if (!weight_kg || !height_cm || height_cm <= 0) return null;
    const heightM = height_cm / 100;
    return Math.round((weight_kg / (heightM * heightM)) * 10) / 10;
  }

  private async applyIntake(
    tx: Prisma.TransactionClient,
    visitId: string,
    intake: VisitIntakeFieldsDto,
    profileId: string,
  ) {
    if (this.hasComplaintIntake(intake)) {
      const data: Prisma.VisitEncounterUncheckedUpdateInput = {
        ...(intake.chief_complaint !== undefined && {
          chief_complaint: intake.chief_complaint,
        }),
        ...(intake.chief_complaint_meta !== undefined && {
          chief_complaint_meta:
            intake.chief_complaint_meta as Prisma.InputJsonValue,
        }),
      };
      await tx.visitEncounter.upsert({
        where: { visit_id: visitId },
        create: {
          visit_id: visitId,
          ...data,
        } as Prisma.VisitEncounterUncheckedCreateInput,
        update: data,
      });
    }
    if (this.hasVitalsIntake(intake)) {
      const v = intake.vitals!;
      const data = {
        systolic_bp: v.systolic_bp ?? null,
        diastolic_bp: v.diastolic_bp ?? null,
        pulse: v.pulse ?? null,
        temperature_c: v.temperature_c ?? null,
        respiratory_rate: v.respiratory_rate ?? null,
        spo2: v.spo2 ?? null,
        weight_kg: v.weight_kg ?? null,
        height_cm: v.height_cm ?? null,
        bmi: this.computeBmi(v.weight_kg, v.height_cm),
      };
      await tx.visitVitals.upsert({
        where: { visit_id: visitId },
        create: { visit_id: visitId, recorded_by_id: profileId, ...data },
        update: { recorded_by_id: profileId, recorded_at: new Date(), ...data },
      });
    }
  }

  private async assertEpisodeInOrg(episodeId: string, organizationId: string) {
    const episode = await this.prismaService.db.patientEpisode.findUnique({
      where: { id: episodeId, is_deleted: false },
      include: { journey: { select: { organization_id: true } } },
    });
    if (
      !episode ||
      !episode.journey ||
      episode.journey.organization_id !== organizationId
    ) {
      throw new NotFoundException(`Episode ${episodeId} not found`);
    }
    return episode;
  }

  async create(episodeId: string, dto: CreateVisitDto, user: AuthContext) {
    await this.assertEpisodeInOrg(episodeId, user.organizationId);
    const branchId = dto.branch_id ?? user.activeBranchId;
    if (!branchId) throw new BadRequestException('branch_id is required');
    return this.prismaService.db.$transaction(async (tx) => {
      const visit = await tx.visit.create({
        data: {
          episode_id: episodeId,
          assigned_doctor_id: dto.assigned_doctor_id,
          branch_id: branchId,
          appointment_type: dto.appointment_type,
          priority: dto.priority,
          scheduled_at: new Date(dto.scheduled_at),
          created_by_id: user.profileId,
        },
      });
      await this.applyIntake(tx, visit.id, dto, user.profileId);
      return visit;
    });
  }

  async bookVisit(dto: BookVisitDto, user: AuthContext) {
    if (!dto.patient_id) {
      const required = [
        'national_id',
        'full_name',
        'date_of_birth',
        'phone_number',
        'address',
      ] as const;
      const missing = required.filter((f) => !dto[f]);
      if (missing.length) {
        throw new BadRequestException(
          'Either patient_id or all new-patient fields (national_id, full_name, date_of_birth, phone_number, address) must be provided',
        );
      }
    }
    // Marital status normalization: legacy `is_married` is honoured when the
    // new `marital_status` field isn't supplied so older clients keep working.
    const resolvedMaritalStatus =
      dto.marital_status ?? (dto.is_married ? 'MARRIED' : undefined);

    if (dto.is_married && !dto.husband_name && !dto.spouse_full_name) {
      throw new BadRequestException(
        'husband_name is required when is_married is true',
      );
    }

    const hasSpouseFields = !!(
      dto.spouse_full_name ||
      dto.spouse_national_id ||
      dto.spouse_phone_number ||
      dto.spouse_guardian_id
    );
    if (resolvedMaritalStatus === 'MARRIED' && hasSpouseFields) {
      // spouse_national_id is optional, but a name (or a picked guardian id)
      // is the minimum identity. national_id alone is not enough.
      if (
        !dto.spouse_full_name &&
        !dto.spouse_guardian_id &&
        (dto.spouse_national_id || dto.spouse_phone_number)
      ) {
        throw new BadRequestException(
          'spouse_full_name is required when other spouse fields are supplied',
        );
      }
    }
    if (
      resolvedMaritalStatus &&
      resolvedMaritalStatus !== 'MARRIED' &&
      hasSpouseFields
    ) {
      throw new BadRequestException(
        'Spouse fields may only be supplied when marital_status is MARRIED',
      );
    }

    const branchId = dto.branch_id ?? user.activeBranchId;
    if (!branchId) throw new BadRequestException('branch_id is required');

    const template = await this.prismaService.db.journeyTemplate.findFirst({
      where: { type: 'GENERAL_GYN', is_deleted: false },
      include: {
        episodes: { where: { is_deleted: false }, orderBy: { order: 'asc' } },
      },
    });
    if (!template || !template.episodes.length) {
      throw new NotFoundException(
        'GENERAL_GYN journey template not configured',
      );
    }
    const firstEpisodeTemplate = template.episodes[0];

    const result = await this.prismaService.db.$transaction(async (tx) => {
      let patient;
      let patientWasJustCreated = false;
      if (dto.patient_id) {
        patient = await tx.patient.findUnique({
          where: { id: dto.patient_id, is_deleted: false },
        });
        if (!patient)
          throw new NotFoundException(`Patient ${dto.patient_id} not found`);
      } else {
        const existing = await tx.patient.findUnique({
          where: { national_id: dto.national_id! },
        });
        if (existing && !existing.is_deleted) {
          throw new ConflictException(
            'A patient with this national_id already exists',
          );
        }
        patient = await tx.patient.create({
          data: {
            full_name: dto.full_name!,
            national_id: dto.national_id!,
            date_of_birth: new Date(dto.date_of_birth!),
            phone_number: dto.phone_number!,
            address: dto.address!,
            husband_name:
              resolvedMaritalStatus === 'MARRIED'
                ? (dto.husband_name ?? dto.spouse_full_name ?? null)
                : null,
            ...(resolvedMaritalStatus
              ? { marital_status: resolvedMaritalStatus }
              : {}),
          },
        });
        patientWasJustCreated = true;
      }

      // For looked-up patients, the caller may be re-affirming or changing
      // marital state — sync if it differs. For just-created patients, the
      // create already set marital_status, so skip.
      if (
        !patientWasJustCreated &&
        resolvedMaritalStatus &&
        patient.marital_status !== resolvedMaritalStatus
      ) {
        await tx.patient.update({
          where: { id: patient.id },
          data: { marital_status: resolvedMaritalStatus },
        });
        patient.marital_status = resolvedMaritalStatus;
      }

      // SPOUSE link. Three paths:
      //   1. `spouse_guardian_id` provided  → existing Guardian picked from
      //      autocomplete; just ensure the PatientGuardian link exists.
      //   2. `spouse_national_id` provided  → upsert Guardian by national_id.
      //   3. Only `spouse_full_name`        → no Guardian row; the name lives
      //      on Patient.husband_name (set during patient.create above).
      let spouseGuardianId: string | null = null;
      if (resolvedMaritalStatus === 'MARRIED' && dto.spouse_guardian_id) {
        const picked = await tx.guardian.findFirst({
          where: { id: dto.spouse_guardian_id, is_deleted: false },
        });
        if (!picked) {
          throw new NotFoundException(
            `Guardian ${dto.spouse_guardian_id} not found`,
          );
        }
        spouseGuardianId = picked.id;
      } else if (
        resolvedMaritalStatus === 'MARRIED' &&
        dto.spouse_full_name &&
        dto.spouse_national_id
      ) {
        const spouse = await tx.guardian.upsert({
          where: { national_id: dto.spouse_national_id },
          create: {
            national_id: dto.spouse_national_id,
            full_name: dto.spouse_full_name,
            phone_number: dto.spouse_phone_number ?? null,
          },
          update: {
            full_name: dto.spouse_full_name,
            ...(dto.spouse_phone_number !== undefined && {
              phone_number: dto.spouse_phone_number,
            }),
          },
        });
        spouseGuardianId = spouse.id;
      }

      if (spouseGuardianId) {
        const existingLink = await tx.patientGuardian.findUnique({
          where: {
            patient_id_guardian_id: {
              patient_id: patient.id,
              guardian_id: spouseGuardianId,
            },
          },
        });
        if (!existingLink) {
          await tx.patientGuardian.create({
            data: {
              patient_id: patient.id,
              guardian_id: spouseGuardianId,
              relation_to_patient: 'SPOUSE',
              is_primary: true,
            },
          });
        } else if (
          existingLink.relation_to_patient !== 'SPOUSE' ||
          !existingLink.is_primary
        ) {
          await tx.patientGuardian.update({
            where: { id: existingLink.id },
            data: { relation_to_patient: 'SPOUSE', is_primary: true },
          });
        }
      }

      let journey = await tx.patientJourney.findFirst({
        where: {
          patient_id: patient.id,
          organization_id: user.organizationId,
          journey_template_id: template.id,
          status: 'ACTIVE',
          is_deleted: false,
        },
      });

      let episode;
      if (journey) {
        episode = await tx.patientEpisode.findFirst({
          where: {
            journey_id: journey.id,
            episode_template_id: firstEpisodeTemplate.id,
            is_deleted: false,
          },
        });
        if (!episode)
          throw new NotFoundException('General Consultation episode not found');
      } else {
        journey = await tx.patientJourney.create({
          data: {
            patient_id: patient.id,
            organization_id: user.organizationId,
            journey_template_id: template.id,
            created_by_id: user.profileId,
            status: 'ACTIVE',
          },
        });
        await tx.patientEpisode.createMany({
          data: template.episodes.map((ep, index) => ({
            journey_id: journey!.id,
            episode_template_id: ep.id,
            name: ep.name,
            order: ep.order,
            status: index === 0 ? ('ACTIVE' as const) : ('PENDING' as const),
            started_at: index === 0 ? new Date() : null,
          })),
        });
        episode = await tx.patientEpisode.findFirst({
          where: {
            journey_id: journey.id,
            episode_template_id: firstEpisodeTemplate.id,
            is_deleted: false,
          },
        });
        if (!episode)
          throw new NotFoundException('General Consultation episode not found');
      }

      const visit = await tx.visit.create({
        data: {
          episode_id: episode.id,
          assigned_doctor_id: dto.assigned_doctor_id,
          branch_id: branchId,
          appointment_type: dto.appointment_type,
          priority: dto.priority,
          scheduled_at: new Date(dto.scheduled_at),
          created_by_id: user.profileId,
        },
      });
      await this.applyIntake(tx, visit.id, dto, user.profileId);

      return { visit, episode: episode, journey, patient };
    });

    this.eventBus.publish('visit.booked', {
      assignedDoctorId: dto.assigned_doctor_id,
      branchId,
      payload: result,
    });
    return result;
  }

  async findAllForEpisode(
    episodeId: string,
    user: AuthContext,
    query: { page?: number; limit?: number },
  ) {
    await this.assertEpisodeInOrg(episodeId, user.organizationId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { episode_id: episodeId, is_deleted: false };
    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visit.findMany({
        where,
        orderBy: { scheduled_at: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaService.db.visit.count({ where }),
    ]);
    return paginated(visits, { page, limit, total });
  }

  async findAllForBranch(
    branchId: string,
    status: VisitStatus,
    query: { page?: number; limit?: number; from?: string; to?: string },
    user: AuthContext,
  ) {
    const branch = await this.prismaService.db.branch.findFirst({
      where: {
        id: branchId,
        organization_id: user.organizationId,
        is_deleted: false,
      },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException(`Branch ${branchId} not found`);

    const isOwner = user.roles.includes('OWNER');
    const isInBranch = user.branchIds.includes(branchId);
    if (!isOwner && !isInBranch) {
      throw new ForbiddenException('Access denied');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      branch_id: branchId,
      status,
      is_deleted: false,
      ...(query.from &&
        query.to && {
          scheduled_at: {
            gte: new Date(query.from),
            lte: new Date(query.to),
          },
        }),
    };

    const orderBy =
      status === 'CHECKED_IN'
        ? { queue_number: 'asc' as const }
        : { scheduled_at: 'asc' as const };

    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visit.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          assigned_doctor: {
            select: {
              id: true,
              specialty_links: {
                select: {
                  specialty: { select: { id: true, code: true, name: true } },
                },
              },
              user: { select: { id: true, first_name: true, last_name: true } },
            },
          },
          episode: {
            select: {
              id: true,
              journey: {
                select: {
                  patient: { select: { id: true, full_name: true } },
                },
              },
            },
          },
        },
      }),
      this.prismaService.db.visit.count({ where }),
    ]);

    return paginated(visits, { page, limit, total });
  }

  private todayBounds() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  private listInclude = {
    assigned_doctor: {
      select: {
        id: true,
        specialty: true,
        user: { select: { id: true, first_name: true, last_name: true } },
      },
    },
    episode: {
      select: {
        id: true,
        journey: {
          select: {
            patient: { select: { id: true, full_name: true } },
          },
        },
      },
    },
  } as const;

  private async assertBranchAccess(branchId: string, user: AuthContext) {
    const branch = await this.prismaService.db.branch.findFirst({
      where: {
        id: branchId,
        organization_id: user.organizationId,
        is_deleted: false,
      },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException(`Branch ${branchId} not found`);

    const isOwner = user.roles.includes('OWNER');
    const isInBranch = user.branchIds.includes(branchId);
    if (!isOwner && !isInBranch) {
      throw new ForbiddenException('Access denied');
    }
  }

  async findBranchWaitingList(
    branchId: string,
    query: { page?: number; limit?: number },
    user: AuthContext,
  ) {
    await this.assertBranchAccess(branchId, user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { start, end } = this.todayBounds();
    const where: Prisma.VisitWhereInput = {
      branch_id: branchId,
      is_deleted: false,
      status: { in: ['SCHEDULED', 'CHECKED_IN'] },
      scheduled_at: { gte: start, lte: end },
    };

    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visit.findMany({
        where,
        orderBy: [
          { status: 'asc' },
          { queue_number: 'asc' },
          { scheduled_at: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
        include: this.listInclude,
      }),
      this.prismaService.db.visit.count({ where }),
    ]);
    return paginated(visits, { page, limit, total });
  }

  async findBranchInProgress(
    branchId: string,
    query: { page?: number; limit?: number },
    user: AuthContext,
  ) {
    await this.assertBranchAccess(branchId, user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { start, end } = this.todayBounds();
    const where: Prisma.VisitWhereInput = {
      branch_id: branchId,
      is_deleted: false,
      status: 'IN_PROGRESS',
      started_at: { gte: start, lte: end },
    };

    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visit.findMany({
        where,
        orderBy: { started_at: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: this.listInclude,
      }),
      this.prismaService.db.visit.count({ where }),
    ]);
    return paginated(visits, { page, limit, total });
  }

  async findMyWaitingList(
    query: { page?: number; limit?: number },
    user: AuthContext,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { start, end } = this.todayBounds();
    const where: Prisma.VisitWhereInput = {
      assigned_doctor_id: user.profileId,
      is_deleted: false,
      status: { in: ['SCHEDULED', 'CHECKED_IN'] },
      scheduled_at: { gte: start, lte: end },
    };

    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visit.findMany({
        where,
        orderBy: [
          { status: 'asc' },
          { queue_number: 'asc' },
          { scheduled_at: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
        include: this.listInclude,
      }),
      this.prismaService.db.visit.count({ where }),
    ]);
    return paginated(visits, { page, limit, total });
  }

  async findMyCurrent(user: AuthContext) {
    const visit = await this.prismaService.db.visit.findFirst({
      where: {
        assigned_doctor_id: user.profileId,
        status: 'IN_PROGRESS',
        is_deleted: false,
      },
      orderBy: { started_at: 'desc' },
      include: this.listInclude,
    });
    return { data: visit };
  }

  async findOne(id: string, user: AuthContext) {
    const visit = await this.prismaService.db.visit.findUnique({
      where: { id, is_deleted: false },
      include: {
        episode: {
          include: { journey: { select: { organization_id: true } } },
        },
      },
    });
    if (
      !visit ||
      !visit.episode?.journey ||
      visit.episode.journey.organization_id !== user.organizationId
    ) {
      throw new NotFoundException(`Visit ${id} not found`);
    }
    return visit;
  }

  async update(id: string, dto: UpdateVisitDto, user: AuthContext) {
    const visit = await this.findOne(id, user);
    if (TERMINAL_STATES.includes(visit.status)) {
      throw new BadRequestException(
        `Cannot update a visit in terminal status: ${visit.status}`,
      );
    }
    const updated = await this.prismaService.db.$transaction(async (tx) => {
      const next = await tx.visit.update({
        where: { id },
        data: {
          ...(dto.assigned_doctor_id !== undefined && {
            assigned_doctor_id: dto.assigned_doctor_id,
          }),
          ...(dto.branch_id !== undefined && { branch_id: dto.branch_id }),
          ...(dto.appointment_type !== undefined && {
            appointment_type: dto.appointment_type,
          }),
          ...(dto.priority !== undefined && { priority: dto.priority }),
          ...(dto.scheduled_at !== undefined && {
            scheduled_at: new Date(dto.scheduled_at),
          }),
        },
      });
      await this.applyIntake(tx, id, dto, user.profileId);
      return next;
    });

    this.eventBus.publish('visit.updated', {
      assignedDoctorId: updated.assigned_doctor_id,
      branchId: updated.branch_id,
      payload: updated,
    });
    return updated;
  }

  async updateStatus(id: string, dto: UpdateVisitStatusDto, user: AuthContext) {
    const visit = await this.findOne(id, user);
    const allowedNext = VALID_TRANSITIONS[visit.status];
    if (!allowedNext.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${visit.status} to ${dto.status}`,
      );
    }
    if (dto.status === 'COMPLETED') {
      const encounter = await this.prismaService.db.visitEncounter.findUnique({
        where: { visit_id: id },
        select: { chief_complaint: true },
      });
      if (!encounter || !encounter.chief_complaint?.trim()) {
        throw new BadRequestException(
          'Cannot complete visit without an encounter and a chief complaint',
        );
      }
    }
    const timestampField = STATUS_TIMESTAMPS[dto.status];
    const now = new Date();

    const updatedVisit = await this.prismaService.db.$transaction(
      async (tx) => {
        const queueNumber =
          dto.status === 'CHECKED_IN'
            ? await this.getNextQueueNumber(
                tx,
                visit.assigned_doctor_id,
                visit.branch_id,
                now,
              )
            : undefined;

        return tx.visit.update({
          where: { id },
          data: {
            status: dto.status,
            ...(timestampField ? { [timestampField]: now } : {}),
            ...(queueNumber !== undefined ? { queue_number: queueNumber } : {}),
          },
        });
      },
    );

    this.eventBus.publish('visit.status_updated', {
      assignedDoctorId: updatedVisit.assigned_doctor_id,
      branchId: updatedVisit.branch_id,
      payload: updatedVisit,
    });
    return updatedVisit;
  }

  async setFollowUp(id: string, dto: SetFollowUpDto, user: AuthContext) {
    const visit = await this.findOne(id, user);
    if (visit.assigned_doctor_id !== user.profileId) {
      throw new ForbiddenException(
        'Only the assigned doctor can set follow-up',
      );
    }
    if (TERMINAL_STATES.includes(visit.status)) {
      throw new BadRequestException(
        `Cannot set follow-up while visit is ${visit.status}`,
      );
    }
    return this.prismaService.db.visit.update({
      where: { id },
      data: {
        ...(dto.follow_up_date !== undefined && {
          follow_up_date: dto.follow_up_date
            ? new Date(dto.follow_up_date)
            : null,
        }),
        ...(dto.follow_up_notes !== undefined && {
          follow_up_notes: dto.follow_up_notes,
        }),
      },
    });
  }
}
