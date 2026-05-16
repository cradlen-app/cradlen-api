import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MaritalStatus, Prisma, VisitStatus } from '@prisma/client';
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
import {
  TemplateValidator,
  ValidatePayloadOptions,
  ValidationError,
} from '@builder/validator/template.validator.js';
import { TemplatesService } from '@builder/templates/templates.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { buildRevision } from '@common/utils/revisions.helper.js';
import { CLINICAL_EVENTS } from '@core/clinical/events/clinical-events.js';

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
    private readonly templateValidator: TemplateValidator,
    private readonly templatesService: TemplatesService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  /**
   * Append-only queue numbering by scheduled_at-day bucket.
   *
   * Note: no `is_deleted` filter — cancelled/no-show/soft-deleted visits still
   * count as occupying their slot. Cancelling leaves a gap (intentional;
   * stable numbers were a locked design decision).
   */
  private async getNextQueueNumberForSchedule(
    tx: Prisma.TransactionClient,
    assignedDoctorId: string,
    branchId: string,
    scheduledAt: Date,
  ): Promise<number> {
    const dayStart = new Date(scheduledAt);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(scheduledAt);
    dayEnd.setHours(23, 59, 59, 999);

    const last = await tx.visit.findFirst({
      where: {
        assigned_doctor_id: assignedDoctorId,
        branch_id: branchId,
        scheduled_at: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { queue_number: 'desc' },
      select: { queue_number: true },
    });

    return (last?.queue_number ?? 0) + 1;
  }

  private isSameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
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
      const fields: Prisma.VisitEncounterUncheckedUpdateInput = {
        ...(intake.chief_complaint !== undefined && {
          chief_complaint: intake.chief_complaint,
        }),
        ...(intake.chief_complaint_meta !== undefined && {
          chief_complaint_meta:
            intake.chief_complaint_meta as Prisma.InputJsonValue,
        }),
      };

      // Snapshot prior encounter (if any) inside the same tx so updates that
      // come through this path leave a revision row — M8 audit guarantee
      // applies to every write to visit_encounters, not just the
      // EncounterService.upsert entry point.
      const prior = await tx.visitEncounter.findUnique({
        where: { visit_id: visitId },
      });

      if (!prior) {
        await tx.visitEncounter.create({
          data: {
            visit_id: visitId,
            updated_by_id: profileId,
            ...fields,
          } as Prisma.VisitEncounterUncheckedCreateInput,
        });
      } else {
        const changed = Object.keys(fields).filter(
          (k) =>
            JSON.stringify((prior as Record<string, unknown>)[k]) !==
            JSON.stringify((fields as Record<string, unknown>)[k]),
        );
        if (changed.length > 0) {
          await tx.visitEncounterRevision.create({
            data: buildRevision(prior, changed, profileId),
          });
          await tx.visitEncounter.update({
            where: { id: prior.id },
            data: {
              ...fields,
              updated_by_id: profileId,
              version: { increment: 1 },
            },
          });
        }
      }
    }
    if (this.hasVitalsIntake(intake)) {
      // TODO (F3b): VisitVitalsRevision shadow table is backlog. Until that
      // lands, vitals updates overwrite without an audit row.
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

  /**
   * Runs the server-side TemplateValidator against the submitted payload for
   * the shared `book_visit` shell. If the specialty has a registered
   * extension (e.g. OBGYN), it's composed in so specialty-specific predicates
   * are enforced too. A missing extension is not fatal — the server falls
   * back to shell-only validation rather than 404-ing on the booking.
   */
  private async assertTemplateValid(
    payload: Record<string, unknown>,
    options: ValidatePayloadOptions,
  ) {
    let result;
    try {
      result = await this.templateValidator.validatePayload(
        'book_visit',
        payload,
        options,
      );
    } catch (err) {
      if (err instanceof NotFoundException && options.extensionKey) {
        result = await this.templateValidator.validatePayload(
          'book_visit',
          payload,
          { ...options, extensionKey: null },
        );
      } else {
        throw err;
      }
    }
    if (!result.ok) throw this.buildTemplateValidationError(result.errors);
  }

  private buildTemplateValidationError(
    errors: ValidationError[],
  ): BadRequestException {
    const messages = errors.map((e) => `${e.fieldCode} ${e.message}`);
    return new BadRequestException({ message: messages });
  }

  /**
   * Verifies that the assigned doctor has the submitted specialty among their
   * `specialty_links`. The form-template renders the doctor picker as
   * `?specialty_code={specialty_code}` so a compliant frontend can never pair
   * mismatched values — but a scripted client could, and the doctor list
   * filter alone doesn't gate the booking write. This check closes that gap.
   */
  private async assertDoctorSpecialty(
    doctorId: string,
    specialtyCode: string,
    organizationId: string,
  ) {
    const profile = await this.prismaService.db.profile.findFirst({
      where: {
        id: doctorId,
        organization_id: organizationId,
        is_deleted: false,
        specialty_links: {
          some: { specialty: { code: specialtyCode, is_deleted: false } },
        },
      },
      select: { id: true },
    });
    if (!profile) {
      throw new BadRequestException({
        message: [
          `assigned_doctor_id does not have specialty "${specialtyCode}"`,
        ],
      });
    }
  }

  /**
   * Marital ↔ spouse consistency checks shared by bookVisit and update.
   *
   * The form-template's predicates can't enforce these today because the
   * GUARDIAN namespace's binding paths (`full_name`, `national_id`,
   * `phone_number`) collide with PATIENT's at the validator's path-only
   * lookup — `spouse_*` is on the wire DTO but the binding stays abstract.
   * Until the GUARDIAN namespace renames are landed, these stay hand-coded.
   */
  private assertSpouseConsistency(
    dto: BookVisitDto | UpdateVisitDto,
    resolvedMaritalStatus: MaritalStatus | undefined,
  ) {
    const hasSpouseFields = !!(
      dto.spouse_full_name ||
      dto.spouse_national_id ||
      dto.spouse_phone_number ||
      dto.spouse_guardian_id
    );
    if (
      !dto.spouse_full_name &&
      !dto.spouse_guardian_id &&
      (dto.spouse_national_id || dto.spouse_phone_number)
    ) {
      throw new BadRequestException(
        'spouse_full_name is required when other spouse fields are supplied',
      );
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
    const scheduledAt = new Date(dto.scheduled_at);
    return this.prismaService.db.$transaction(async (tx) => {
      const queueNumber = await this.getNextQueueNumberForSchedule(
        tx,
        dto.assigned_doctor_id,
        branchId,
        scheduledAt,
      );
      const visit = await tx.visit.create({
        data: {
          episode_id: episodeId,
          assigned_doctor_id: dto.assigned_doctor_id,
          branch_id: branchId,
          appointment_type: dto.appointment_type,
          priority: dto.priority,
          scheduled_at: scheduledAt,
          created_by_id: user.profileId,
          queue_number: queueNumber,
        },
      });
      await this.applyIntake(tx, visit.id, dto, user.profileId);
      return visit;
    });
  }

  async bookVisit(dto: BookVisitDto, user: AuthContext) {
    await this.assertTemplateValid(dto as unknown as Record<string, unknown>, {
      extensionKey: dto.specialty_code,
    });
    await this.assertDoctorSpecialty(
      dto.assigned_doctor_id,
      dto.specialty_code,
      user.organizationId,
    );
    // Stamp the audit anchor: which shell-template version this visit was
    // booked from. Resolve outside the transaction so a missing template
    // 404s before any writes.
    const bookVisitTemplate =
      await this.templatesService.findActiveByCode('book_visit');
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
    const resolvedMaritalStatus = dto.marital_status;
    this.assertSpouseConsistency(dto, resolvedMaritalStatus);

    const branchId = dto.branch_id ?? user.activeBranchId;
    if (!branchId) throw new BadRequestException('branch_id is required');

    // Caller must have access to this branch.
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      user.organizationId,
      branchId,
    );

    // Assigned doctor must be assigned to this branch — the form-template
    // doctor picker filters by branch but a scripted client could submit
    // a mismatched pair.
    const doctorOnBranch = await this.prismaService.db.profileBranch.findFirst({
      where: {
        profile_id: dto.assigned_doctor_id,
        branch_id: branchId,
        organization_id: user.organizationId,
      },
      select: { id: true },
    });
    if (!doctorOnBranch) {
      throw new BadRequestException({
        message: [`assigned_doctor_id is not assigned to branch ${branchId}`],
      });
    }

    // Resolve the JourneyTemplate from the supplied care path (1:1 link added
    // in M14 — care_paths.journey_template_id). When no care_path_code is
    // sent, fall back to the specialty's GENERAL_GYN-coded template.
    let carePathId: string | null = null;
    let template: Prisma.JourneyTemplateGetPayload<{
      include: { episodes: true };
    }> | null = null;
    if (dto.care_path_code) {
      const carePath = await this.prismaService.db.carePath.findFirst({
        where: {
          code: dto.care_path_code,
          is_deleted: false,
          OR: [
            { organization_id: null },
            { organization_id: user.organizationId },
          ],
        },
        include: {
          journey_template: {
            include: {
              episodes: {
                where: { is_deleted: false },
                orderBy: { order: 'asc' },
              },
            },
          },
        },
      });
      if (!carePath) {
        throw new NotFoundException(
          `Care path "${dto.care_path_code}" not found`,
        );
      }
      carePathId = carePath.id;
      template = carePath.journey_template;
    } else {
      template = await this.prismaService.db.journeyTemplate.findFirst({
        where: {
          specialty: { code: dto.specialty_code, is_deleted: false },
          code: 'GENERAL_GYN',
          is_deleted: false,
        },
        include: {
          episodes: { where: { is_deleted: false }, orderBy: { order: 'asc' } },
        },
      });
    }
    if (!template || !template.episodes.length) {
      throw new NotFoundException(
        'No journey template resolved for this booking',
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
      //   3. Only `spouse_full_name`        → upsert PatientObgynHistory
      //      .husband_name; no Guardian row.
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
        // Demote any existing primary SPOUSE link to a different guardian
        // before promoting this one. A partial unique index enforces this at
        // the DB level (see `patient_guardians_one_primary_per_relation_unique`
        // in F4 migration) — this updateMany keeps the in-tx state consistent.
        await tx.patientGuardian.updateMany({
          where: {
            patient_id: patient.id,
            relation_to_patient: 'SPOUSE',
            is_primary: true,
            is_deleted: false,
            NOT: { guardian_id: spouseGuardianId },
          },
          data: { is_primary: false },
        });

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
          care_path_id: carePathId,
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
            care_path_id: carePathId,
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

      const scheduledAt = new Date(dto.scheduled_at);
      const queueNumber = await this.getNextQueueNumberForSchedule(
        tx,
        dto.assigned_doctor_id,
        branchId,
        scheduledAt,
      );
      const visit = await tx.visit.create({
        data: {
          episode_id: episode.id,
          assigned_doctor_id: dto.assigned_doctor_id,
          branch_id: branchId,
          appointment_type: dto.appointment_type,
          priority: dto.priority,
          scheduled_at: scheduledAt,
          created_by_id: user.profileId,
          form_template_id: bookVisitTemplate.id,
          queue_number: queueNumber,
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
    query: { page?: number; limit?: number },
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
    const { start, end } = this.todayBounds();
    const where = {
      branch_id: branchId,
      status,
      is_deleted: false,
      scheduled_at: { gte: start, lte: end },
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
        user: { select: { id: true, first_name: true, last_name: true } },
      },
    },
    episode: {
      select: {
        id: true,
        journey: {
          select: {
            organization_id: true,
            patient: { select: { id: true, full_name: true } },
            care_path: { select: { code: true } },
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
    const { start, end } = this.todayBounds();
    const visit = await this.prismaService.db.visit.findFirst({
      where: {
        assigned_doctor_id: user.profileId,
        status: 'IN_PROGRESS',
        is_deleted: false,
        started_at: { gte: start, lte: end },
      },
      orderBy: { started_at: 'desc' },
      include: this.listInclude,
    });
    return { data: visit };
  }

  async findOne(id: string, user: AuthContext) {
    const visit = await this.prismaService.db.visit.findUnique({
      where: { id, is_deleted: false },
      include: this.listInclude,
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
    // Update DTO has no visitor_type — it's immutable per visit. Inject it so
    // the validator can evaluate visitor_type-keyed forbidden predicates
    // against any cross-discriminator fields slipping into the patch.
    await this.assertTemplateValid(
      {
        ...(dto as unknown as Record<string, unknown>),
        visitor_type: 'PATIENT',
      },
      {
        extensionKey: dto.specialty_code ?? null,
        sparse: true,
      },
    );
    // Doctor↔specialty consistency: only verifiable when the patch carries a
    // specialty_code (prior specialty isn't persisted on Visit). Use the
    // final doctor — either the patched one or the current assignment.
    if (dto.specialty_code) {
      const finalDoctorId = dto.assigned_doctor_id ?? visit.assigned_doctor_id;
      await this.assertDoctorSpecialty(
        finalDoctorId,
        dto.specialty_code,
        user.organizationId,
      );
    }

    const resolvedMaritalStatus = dto.marital_status;
    this.assertSpouseConsistency(dto, resolvedMaritalStatus);
    const hasSpouseFields = !!(
      dto.spouse_full_name ||
      dto.spouse_national_id ||
      dto.spouse_phone_number ||
      dto.spouse_guardian_id
    );

    const updated = await this.prismaService.db.$transaction(async (tx) => {
      const patientUpdates: Prisma.PatientUpdateInput = {
        ...(dto.full_name !== undefined && { full_name: dto.full_name }),
        ...(dto.national_id !== undefined && { national_id: dto.national_id }),
        ...(dto.date_of_birth !== undefined && {
          date_of_birth: new Date(dto.date_of_birth),
        }),
        ...(dto.phone_number !== undefined && {
          phone_number: dto.phone_number,
        }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(resolvedMaritalStatus !== undefined && {
          marital_status: resolvedMaritalStatus,
        }),
      };
      const patientId = visit.episode.journey.patient.id;
      if (Object.keys(patientUpdates).length > 0) {
        await tx.patient.update({
          where: { id: patientId },
          data: patientUpdates,
        });
      }

      if (resolvedMaritalStatus === 'MARRIED' && hasSpouseFields) {
        await this.applySpouseLink(tx, patientId, dto);
      }

      // If the (doctor, branch, day) bucket changes, re-issue queue_number
      // for the destination bucket. Source-bucket gap remains (matches
      // cancel-leaves-gap semantics).
      const nextDoctor = dto.assigned_doctor_id ?? visit.assigned_doctor_id;
      const nextBranch = dto.branch_id ?? visit.branch_id;
      const nextScheduledAt = dto.scheduled_at
        ? new Date(dto.scheduled_at)
        : visit.scheduled_at;
      const bucketChanged =
        nextDoctor !== visit.assigned_doctor_id ||
        nextBranch !== visit.branch_id ||
        !this.isSameDay(nextScheduledAt, visit.scheduled_at);
      const rebookedQueueNumber = bucketChanged
        ? await this.getNextQueueNumberForSchedule(
            tx,
            nextDoctor,
            nextBranch,
            nextScheduledAt,
          )
        : undefined;

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
          ...(rebookedQueueNumber !== undefined && {
            queue_number: rebookedQueueNumber,
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
    const isTerminal = dto.status === 'CANCELLED' || dto.status === 'NO_SHOW';

    const journeyId = visit.episode?.journey
      ? (
          await this.prismaService.db.patientEpisode.findUnique({
            where: { id: visit.episode.id },
            select: { journey_id: true },
          })
        )?.journey_id
      : undefined;

    const { updatedVisit, cascaded } = await this.prismaService.db.$transaction(
      async (tx) => {
        const next = await tx.visit.update({
          where: { id },
          data: {
            status: dto.status,
            ...(timestampField ? { [timestampField]: now } : {}),
          },
        });

        let didCascade = false;
        if (isTerminal && journeyId) {
          // F5 — if this cancel/no-show leaves the journey with no real
          // (ever-checked-in) visits and no remaining live visits, soft-delete
          // the whole journey + episodes + visits + encounter/vitals.
          const [realCount, liveCount] = await Promise.all([
            tx.visit.count({
              where: {
                episode: { journey_id: journeyId },
                checked_in_at: { not: null },
                is_deleted: false,
              },
            }),
            tx.visit.count({
              where: {
                episode: { journey_id: journeyId },
                is_deleted: false,
                status: { notIn: ['CANCELLED', 'NO_SHOW'] },
              },
            }),
          ]);

          if (realCount === 0 && liveCount === 0) {
            await tx.visitEncounter.updateMany({
              where: {
                visit: { episode: { journey_id: journeyId } },
                is_deleted: false,
              },
              data: { is_deleted: true, deleted_at: now },
            });
            await tx.visitVitals.updateMany({
              where: {
                visit: { episode: { journey_id: journeyId } },
                is_deleted: false,
              },
              data: { is_deleted: true, deleted_at: now },
            });
            await tx.visit.updateMany({
              where: {
                episode: { journey_id: journeyId },
                is_deleted: false,
              },
              data: { is_deleted: true, deleted_at: now },
            });
            await tx.patientEpisode.updateMany({
              where: { journey_id: journeyId, is_deleted: false },
              data: { is_deleted: true, deleted_at: now },
            });
            await tx.patientJourney.update({
              where: { id: journeyId },
              data: {
                is_deleted: true,
                deleted_at: now,
                status: 'CANCELLED',
                ended_at: now,
              },
            });
            didCascade = true;
          }
        }

        return { updatedVisit: next, cascaded: didCascade };
      },
    );

    if (cascaded) {
      this.eventBus.publish(CLINICAL_EVENTS.journey.cancelledEmpty, {
        journeyId,
        patientId: visit.episode?.journey?.patient.id,
        organizationId: visit.episode?.journey?.organization_id,
      });
    }
    this.eventBus.publish('visit.status_updated', {
      assignedDoctorId: updatedVisit.assigned_doctor_id,
      branchId: updatedVisit.branch_id,
      payload: updatedVisit,
    });
    return updatedVisit;
  }

  private async applySpouseLink(
    tx: Prisma.TransactionClient,
    patientId: string,
    dto: UpdateVisitDto,
  ) {
    let spouseGuardianId: string | null = null;
    if (dto.spouse_guardian_id) {
      const picked = await tx.guardian.findFirst({
        where: { id: dto.spouse_guardian_id, is_deleted: false },
      });
      if (!picked) {
        throw new NotFoundException(
          `Guardian ${dto.spouse_guardian_id} not found`,
        );
      }
      spouseGuardianId = picked.id;
    } else if (dto.spouse_full_name && dto.spouse_national_id) {
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
    } else if (dto.spouse_full_name) {
      // Name-only update — store on PatientObgynHistory.husband_name (lazy
      // upsert; no version bump/audit since this is bookkeeping, not a
      // clinical mutation through the obgyn-history PATCH path).
      await tx.patientObgynHistory.upsert({
        where: { patient_id: patientId },
        create: {
          patient_id: patientId,
          husband_name: dto.spouse_full_name,
        },
        update: { husband_name: dto.spouse_full_name },
      });
    }

    if (spouseGuardianId) {
      const existingLink = await tx.patientGuardian.findUnique({
        where: {
          patient_id_guardian_id: {
            patient_id: patientId,
            guardian_id: spouseGuardianId,
          },
        },
      });
      if (!existingLink) {
        await tx.patientGuardian.create({
          data: {
            patient_id: patientId,
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
