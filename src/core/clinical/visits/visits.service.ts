import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import {
  AppointmentType,
  ChargeStatus,
  MaritalStatus,
  Prisma,
  VisitStatus,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { UpdateVisitDto } from './dto/update-visit.dto';
import { BookVisitDto } from './dto/book-visit.dto';
import { VisitIntakeFieldsDto } from './dto/visit-intake.dto';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { paginated } from '@common/utils/pagination.utils';
import { dayBounds, todayBounds } from '@common/utils/date-range.utils.js';
import { ERROR_CODES } from '@common/constant/error-codes.js';
import { assertBookVisitPayloadValid } from '../shared/book-visit-validation.js';
import { nextQueueNumber } from '../shared/queue-number.js';
import {
  TemplateValidator,
  ValidatePayloadOptions,
} from '@builder/validator/template.validator.js';
import { TemplatesService } from '@builder/templates/templates.service.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { ChargingService } from '@core/financial/charging/charging.service.js';
import { InvoicingService } from '@core/financial/invoicing/invoicing.service.js';
import { buildRevision } from '@common/utils/revisions.helper.js';
import { VitalsTrendPointDto } from './dto/vitals-trend-point.dto.js';
import {
  visitHistoryInclude,
  vitalsTrendSelect,
  journeyTimelineInclude,
  toVisitHistorySummary,
  toJourneyTimeline,
  toVitalsTrendPoint,
} from './visits.mapper.js';
import { assertReceptionAction } from './visit-actor.guards.js';
import { TERMINAL_STATES } from './visit-status.constants.js';
import {
  VisitDailyPointDto,
  VisitStatsDto,
  VisitTodayStatsDto,
} from './dto/visit-stats.dto.js';
import { VisitTodayStatsQueryDto } from './dto/list-visits-query.dto.js';

/** Care path a booking falls back to when none is supplied on the DTO. */
const DEFAULT_CARE_PATH_CODE = 'OBGYN_GENERAL';

@Injectable()
export class VisitsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventBus: EventBus,
    private readonly templateValidator: TemplateValidator,
    private readonly templatesService: TemplatesService,
    private readonly authorizationService: AuthorizationService,
    private readonly chargingService: ChargingService,
    private readonly invoicingService: InvoicingService,
  ) {}

  private readonly logger = new Logger(VisitsService.name);

  /**
   * Append-only queue numbering by scheduled_at-day bucket.
   *
   * Note: no `is_deleted` filter — cancelled/no-show/soft-deleted visits still
   * count as occupying their slot. Cancelling leaves a gap (intentional;
   * stable numbers were a locked design decision).
   */
  private getNextQueueNumberForSchedule(
    tx: Prisma.TransactionClient,
    assignedDoctorId: string,
    branchId: string,
    scheduledAt: Date,
  ): Promise<number> {
    return nextQueueNumber(scheduledAt, ({ start, end }) =>
      tx.visit.findFirst({
        where: {
          assigned_doctor_id: assignedDoctorId,
          branch_id: branchId,
          scheduled_at: { gte: start, lte: end },
        },
        orderBy: { queue_number: 'desc' },
        select: { queue_number: true },
      }),
    );
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
      // come through this booking-intake path leave a revision row — the M8
      // audit guarantee applies to every write to visit_encounters.
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
        // Deep, order-independent comparison — a JSON.stringify diff would flag
        // chief_complaint_meta as changed merely because key order differs
        // between the client payload and the stored JSON, writing a spurious
        // revision + version bump.
        const changed = Object.keys(fields).filter(
          (k) =>
            !isDeepStrictEqual(
              (prior as Record<string, unknown>)[k],
              (fields as Record<string, unknown>)[k],
            ),
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
  private assertTemplateValid(
    payload: Record<string, unknown>,
    options: ValidatePayloadOptions,
  ) {
    return assertBookVisitPayloadValid(
      this.templateValidator,
      payload,
      options,
      {
        extensionFallback: true,
      },
    );
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

  private async assertEpisodeInOrg(episodeId: string, organizationId: string) {
    const episode = await this.prismaService.db.patientEpisode.findUnique({
      where: { id: episodeId, is_deleted: false },
      include: {
        journey: { select: { organization_id: true, patient_id: true } },
      },
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

  /**
   * Reject a booking when the patient already has an open visit
   * (SCHEDULED / CHECKED_IN / IN_PROGRESS) in the same branch on the same
   * calendar day — i.e. one that already occupies a slot in that day's waiting
   * list. Runs on the transaction client so the check is atomic with the
   * insert.
   */
  private async assertNoOpenVisitForPatient(
    tx: Prisma.TransactionClient,
    args: { patientId: string; branchId: string; scheduledAt: Date },
  ): Promise<void> {
    const { start, end } = dayBounds(args.scheduledAt);
    const existing = await tx.visit.findFirst({
      where: {
        branch_id: args.branchId,
        is_deleted: false,
        status: {
          in: ['SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS', 'IN_CONSULTATION'],
        },
        scheduled_at: { gte: start, lte: end },
        episode: { journey: { patient_id: args.patientId } },
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: ERROR_CODES.PATIENT_HAS_OPEN_VISIT,
        message: 'Patient already has an open visit for this day',
        details: { visitId: existing.id },
      });
    }
  }

  async bookVisit(dto: BookVisitDto, user: AuthContext) {
    assertReceptionAction(user, 'Only reception can book visits');
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

    // Financial: a billable service is required at booking, and the assigned
    // doctor must be authorized to deliver it. Validate before any writes.
    await this.assertDoctorAuthorizedForService(
      user.organizationId,
      dto.assigned_doctor_id,
      dto.service_id,
      branchId,
    );

    const { carePathId, template, firstEpisodeTemplate } =
      await this.resolveCarePathTemplate(
        dto.specialty_code,
        dto.care_path_code ?? DEFAULT_CARE_PATH_CODE,
        user.organizationId,
      );

    const result = await this.prismaService.db.$transaction(async (tx) => {
      const patient = await this.resolveOrCreatePatient(
        tx,
        dto,
        resolvedMaritalStatus,
      );

      const scheduledAt = new Date(dto.scheduled_at);
      await this.assertNoOpenVisitForPatient(tx, {
        patientId: patient.id,
        branchId,
        scheduledAt,
      });

      const { episode, journey } = await this.resolveJourneyAndEpisode(tx, {
        patientId: patient.id,
        organizationId: user.organizationId,
        template,
        carePathId,
        firstEpisodeTemplate,
        createdById: user.profileId,
      });

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
          specialty_code: dto.specialty_code,
          queue_number: queueNumber,
        },
      });
      await this.applyIntake(tx, visit.id, dto, user.profileId);

      // Capture the billable charge in the SAME transaction as the visit, so a
      // visit can never exist without its charge (a hard financial invariant).
      // Price/authorization was pre-validated above (assertDoctorAuthorizedForService),
      // so an in-tx failure here is genuinely exceptional and correctly aborts
      // the whole booking. The charge.captured fan-out (which the invoice
      // accrual listener bills on) is deferred to finalizeCapture() after commit.
      const charge = await this.chargingService.captureInTx(
        tx,
        user.organizationId,
        {
          branch_id: branchId,
          patient_id: patient.id,
          profile_id: dto.assigned_doctor_id,
          visit_id: visit.id,
          service_id: dto.service_id,
          quantity: 1,
        },
        user,
      );

      // Enroll the patient in the org, atomically with the booking. createMany
      // + skipDuplicates compiles to INSERT … ON CONFLICT DO NOTHING, so a
      // concurrent booking that already created the (live) enrollment is
      // silently skipped without aborting this transaction.
      await tx.patientOrgEnrollment.createMany({
        data: [
          {
            patient_id: patient.id,
            organization_id: user.organizationId,
            status: 'PENDING',
          },
        ],
        skipDuplicates: true,
      });

      return {
        visit: {
          ...visit,
          chief_complaint: dto.chief_complaint ?? null,
          chief_complaint_meta: dto.chief_complaint_meta ?? null,
        },
        episode: episode,
        journey,
        patient,
        charge,
      };
    });

    // Post-commit fan-out: publish charge.captured (the invoice accrual listener
    // bills the case invoice off it). Best-effort — the charge already committed
    // atomically with the visit above, so a fan-out hiccup must not fail the
    // booking (reception can still settle the PENDING charge manually).
    try {
      this.chargingService.finalizeCapture(result.charge);
    } catch (err) {
      this.logger.error(
        `Failed to finalize booking charge (visit=${result.visit.id}, charge=${result.charge.id})`,
        err as Error,
      );
    }

    this.eventBus.publish('visit.booked', {
      assignedDoctorId: dto.assigned_doctor_id,
      branchId,
      payload: result,
    });
    return result;
  }

  /**
   * A doctor may only be booked against a billable service they're authorized to
   * deliver — an active ProviderService at this branch or org-wide (branch null).
   */
  private async assertDoctorAuthorizedForService(
    organizationId: string,
    profileId: string,
    serviceId: string,
    branchId: string,
  ): Promise<void> {
    const authorized = await this.prismaService.db.providerService.findFirst({
      where: {
        organization_id: organizationId,
        profile_id: profileId,
        service_id: serviceId,
        is_active: true,
        is_deleted: false,
        OR: [{ branch_id: branchId }, { branch_id: null }],
      },
      select: { id: true },
    });
    if (!authorized) {
      throw new BadRequestException(
        'Assigned doctor is not authorized for the selected service',
      );
    }
  }

  /**
   * Resolves the CarePath (and its linked JourneyTemplate) for a booking.
   * Always resolved via CarePath so journey.care_path_id is never null —
   * enabling consistent querying and analytics across all care paths.
   */
  private async resolveCarePathTemplate(
    specialtyCode: string,
    carePathCode: string,
    organizationId: string,
  ) {
    const resolvedCarePath = await this.prismaService.db.carePath.findFirst({
      where: {
        code: carePathCode,
        is_deleted: false,
        specialty: { code: specialtyCode, is_deleted: false },
        OR: [{ organization_id: null }, { organization_id: organizationId }],
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
    if (!resolvedCarePath) {
      throw new NotFoundException(
        `Care path "${carePathCode}" not found for specialty "${specialtyCode}"`,
      );
    }
    const template = resolvedCarePath.journey_template;
    if (!template || !template.episodes.length) {
      throw new NotFoundException(
        'No journey template resolved for this booking',
      );
    }
    return {
      carePathId: resolvedCarePath.id,
      template,
      firstEpisodeTemplate: template.episodes[0],
    };
  }

  /**
   * Loads the patient (by id) or creates a new one (by national_id), then syncs
   * marital_status for looked-up patients when it changed.
   */
  private async resolveOrCreatePatient(
    tx: Prisma.TransactionClient,
    dto: BookVisitDto,
    resolvedMaritalStatus: MaritalStatus | undefined,
  ) {
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
    return patient;
  }

  /**
   * Finds the active journey for (patient, template, care path) or creates the
   * journey + its episodes, then returns the journey and its first episode.
   */
  private async resolveJourneyAndEpisode(
    tx: Prisma.TransactionClient,
    params: {
      patientId: string;
      organizationId: string;
      template: Prisma.JourneyTemplateGetPayload<{
        include: { episodes: true };
      }>;
      carePathId: string;
      firstEpisodeTemplate: { id: string };
      createdById: string;
    },
  ) {
    const {
      patientId,
      organizationId,
      template,
      carePathId,
      firstEpisodeTemplate,
      createdById,
    } = params;

    let journey = await tx.patientJourney.findFirst({
      where: {
        patient_id: patientId,
        organization_id: organizationId,
        journey_template_id: template.id,
        care_path_id: carePathId,
        status: 'ACTIVE',
        is_deleted: false,
      },
    });

    if (!journey) {
      journey = await tx.patientJourney.create({
        data: {
          patient_id: patientId,
          organization_id: organizationId,
          journey_template_id: template.id,
          care_path_id: carePathId,
          created_by_id: createdById,
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
    }

    const episode = await tx.patientEpisode.findFirst({
      where: {
        journey_id: journey.id,
        episode_template_id: firstEpisodeTemplate.id,
        is_deleted: false,
      },
    });
    if (!episode) {
      throw new NotFoundException('General Consultation episode not found');
    }
    return { journey, episode };
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

  async findPatientVisitHistory(
    patientId: string,
    organizationId: string,
    query: { page?: number; limit?: number; excludeVisitId?: string },
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 3;

    const where: Prisma.VisitWhereInput = {
      is_deleted: false,
      status: 'COMPLETED',
      episode: {
        journey: {
          patient_id: patientId,
          organization_id: organizationId,
        },
      },
      ...(query.excludeVisitId ? { id: { not: query.excludeVisitId } } : {}),
    };

    const [visits, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.visit.findMany({
        where,
        orderBy: { completed_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: visitHistoryInclude,
      }),
      this.prismaService.db.visit.count({ where }),
    ]);

    const summaries = visits.map(toVisitHistorySummary);

    return paginated(summaries, { page, limit, total });
  }

  /**
   * Patient journey tree for the Overview timeline: journeys (newest first),
   * each with its episodes and the completed visits under them. Paginated by
   * journey so a group never splits across pages.
   */
  async findPatientJourneyTimeline(
    patientId: string,
    organizationId: string,
    query: { page?: number; limit?: number; excludeVisitId?: string },
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 5;

    const where: Prisma.PatientJourneyWhereInput = {
      is_deleted: false,
      patient_id: patientId,
      organization_id: organizationId,
    };

    const [journeys, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.patientJourney.findMany({
        where,
        orderBy: { started_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: journeyTimelineInclude(query.excludeVisitId),
      }),
      this.prismaService.db.patientJourney.count({ where }),
    ]);

    const timeline = journeys.map(toJourneyTimeline);

    return paginated(timeline, { page, limit, total });
  }

  async findPatientVitalsTrend(
    patientId: string,
    organizationId: string,
    excludeVisitId?: string,
  ): Promise<VitalsTrendPointDto[]> {
    const visits = await this.prismaService.db.visit.findMany({
      where: {
        is_deleted: false,
        status: 'COMPLETED',
        ...(excludeVisitId ? { id: { not: excludeVisitId } } : {}),
        episode: {
          journey: { patient_id: patientId, organization_id: organizationId },
        },
      },
      orderBy: { completed_at: 'asc' },
      select: vitalsTrendSelect,
    });

    return visits.map(toVitalsTrendPoint);
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
    const { start, end } = todayBounds();
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
          encounter: {
            select: { chief_complaint: true, chief_complaint_meta: true },
          },
        },
      }),
      this.prismaService.db.visit.count({ where }),
    ]);

    return paginated(
      visits.map((v) => this.flattenVisit(v)),
      { page, limit, total },
    );
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
            id: true,
            organization_id: true,
            patient: { select: { id: true, full_name: true } },
            care_path: { select: { code: true } },
          },
        },
      },
    },
    encounter: {
      select: { chief_complaint: true, chief_complaint_meta: true },
    },
  } as const;

  /**
   * Lift the visit's encounter scalars (`chief_complaint`,
   * `chief_complaint_meta`) onto the visit object and drop the nested
   * `encounter` key. The frontend (`mapApiVisitToVisit`) reads these flat at
   * the visit root, so list/detail/booking responses present a single shape.
   */
  private flattenVisit<
    T extends {
      encounter?: {
        chief_complaint: string | null;
        chief_complaint_meta: Prisma.JsonValue | null;
      } | null;
    },
  >(visit: T) {
    const { encounter, ...rest } = visit;
    return {
      ...rest,
      chief_complaint: encounter?.chief_complaint ?? null,
      chief_complaint_meta: encounter?.chief_complaint_meta ?? null,
    };
  }

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
    const { start, end } = todayBounds();
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
    return paginated(
      visits.map((v) => this.flattenVisit(v)),
      { page, limit, total },
    );
  }

  async findBranchInProgress(
    branchId: string,
    query: { page?: number; limit?: number },
    user: AuthContext,
  ) {
    await this.assertBranchAccess(branchId, user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { start, end } = todayBounds();
    const where: Prisma.VisitWhereInput = {
      branch_id: branchId,
      is_deleted: false,
      // Both the reception-queued (IN_PROGRESS) and doctor-active
      // (IN_CONSULTATION) patients are "live" for the per-doctor panel.
      status: { in: ['IN_PROGRESS', 'IN_CONSULTATION'] },
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
    return paginated(
      visits.map((v) => this.flattenVisit(v)),
      { page, limit, total },
    );
  }

  async findMyWaitingList(
    branchId: string,
    query: { page?: number; limit?: number },
    user: AuthContext,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { start, end } = todayBounds();
    const where: Prisma.VisitWhereInput = {
      assigned_doctor_id: user.profileId,
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
    return paginated(
      visits.map((v) => this.flattenVisit(v)),
      { page, limit, total },
    );
  }

  async findMyCurrent(branchId: string, user: AuthContext) {
    const { start, end } = todayBounds();
    const visits = await this.prismaService.db.visit.findMany({
      where: {
        assigned_doctor_id: user.profileId,
        branch_id: branchId,
        // The doctor's card carries both their queue (IN_PROGRESS, reception
        // readied) and the patient they're actively seeing (IN_CONSULTATION).
        status: { in: ['IN_PROGRESS', 'IN_CONSULTATION'] },
        is_deleted: false,
        started_at: { gte: start, lte: end },
      },
      orderBy: { started_at: 'asc' },
      include: this.listInclude,
    });
    return { data: visits.map((v) => this.flattenVisit(v)) };
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
    return this.flattenVisit(visit);
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

    // Service change: re-validate doctor authorization and swap the booking
    // charge/invoice line before persisting field edits, so an unauthorized
    // service or an already-paid invoice 400s without a partial visit update.
    // The frontend resubmits the prefilled service on every edit, so act only
    // when it actually differs from the service captured at booking (and the
    // visit has a booking charge to swap).
    if (dto.service_id) {
      const bookingCharge = await this.prismaService.db.charge.findFirst({
        where: {
          organization_id: user.organizationId,
          visit_id: id,
          is_deleted: false,
          service_id: { not: null },
          status: { in: [ChargeStatus.PENDING, ChargeStatus.INVOICED] },
        },
        orderBy: { captured_at: 'asc' },
        select: { service_id: true },
      });
      if (bookingCharge && bookingCharge.service_id !== dto.service_id) {
        const finalDoctorId =
          dto.assigned_doctor_id ?? visit.assigned_doctor_id;
        const finalBranchId = dto.branch_id ?? visit.branch_id;
        await this.assertDoctorAuthorizedForService(
          user.organizationId,
          finalDoctorId,
          dto.service_id,
          finalBranchId,
        );
        await this.invoicingService.swapVisitBookingService({
          organizationId: user.organizationId,
          visitId: id,
          newServiceId: dto.service_id,
          profileId: finalDoctorId,
          branchId: finalBranchId,
          capturedById: user.profileId,
        });
      }
    }

    const resolvedMaritalStatus = dto.marital_status;

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

  /**
   * Monthly visit analytics for a branch: attended-visit counts (total, plain
   * visits, follow-ups) for the current vs the previous calendar month, plus a
   * per-day series for the current month. Branch access is asserted the same way
   * the branch waiting-list endpoints do.
   */
  async getBranchVisitStats(
    branchId: string,
    user: AuthContext,
  ): Promise<VisitStatsDto> {
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      user.organizationId,
      branchId,
    );
    return this.computeVisitStats(user.organizationId, branchId);
  }

  /**
   * OWNER-only org-wide visit analytics — same shape as
   * {@link getBranchVisitStats} but counting every attended visit across the
   * organization's branches.
   */
  async getOrgVisitStats(user: AuthContext): Promise<VisitStatsDto> {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      user.organizationId,
    );
    return this.computeVisitStats(user.organizationId, null);
  }

  /**
   * Today's operational visit counts for a branch (or `query.date`): clinical
   * visits split by appointment type plus medical-rep visits, all counted by
   * `scheduled_at` within the day's bounds (matching the waiting-list view).
   * `assigned_to_me` narrows to the current doctor's own queue. Branch access is
   * asserted the same way the branch waiting-list/stats endpoints do.
   */
  async getBranchTodayVisitStats(
    branchId: string,
    query: VisitTodayStatsQueryDto,
    user: AuthContext,
  ): Promise<VisitTodayStatsDto> {
    await this.authorizationService.assertCanAccessBranch(
      user.profileId,
      user.organizationId,
      branchId,
    );

    const { start, end } = query.date
      ? dayBounds(new Date(query.date))
      : todayBounds();
    const doctorScope = query.assigned_to_me
      ? { assigned_doctor_id: user.profileId }
      : {};

    const visitBase: Prisma.VisitWhereInput = {
      branch_id: branchId,
      is_deleted: false,
      scheduled_at: { gte: start, lte: end },
      ...doctorScope,
    };

    const db = this.prismaService.db;
    const [visits, follow_ups, medical_reps] = await db.$transaction([
      db.visit.count({
        where: { ...visitBase, appointment_type: AppointmentType.VISIT },
      }),
      db.visit.count({
        where: { ...visitBase, appointment_type: AppointmentType.FOLLOW_UP },
      }),
      db.medicalRepVisit.count({
        where: {
          branch_id: branchId,
          is_deleted: false,
          scheduled_at: { gte: start, lte: end },
          ...doctorScope,
        },
      }),
    ]);

    return {
      total_visits: visits + follow_ups,
      visits,
      follow_ups,
      medical_reps,
    };
  }

  /** Local-time first day of the current month — the trend comparison baseline. */
  private startOfCurrentMonth(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  /** Local-time first day of the previous month. */
  private startOfPreviousMonth(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() - 1, 1);
  }

  /**
   * Shared engine for {@link getBranchVisitStats} / {@link getOrgVisitStats}.
   * "Attended" = `checked_in_at` set (matches how patient stats attribute a
   * visit to a branch). `branchId === null` ⇒ org-wide (scope by the branch's
   * organization). Each metric pairs the current month with the previous one.
   */
  private async computeVisitStats(
    organizationId: string,
    branchId: string | null,
  ): Promise<VisitStatsDto> {
    const db = this.prismaService.db;
    const curStart = this.startOfCurrentMonth();
    const prevStart = this.startOfPreviousMonth();

    const scope: Prisma.VisitWhereInput = branchId
      ? { branch_id: branchId }
      : { branch: { organization_id: organizationId } };

    const where = (
      type: AppointmentType | undefined,
      from: Date,
      to?: Date,
    ): Prisma.VisitWhereInput => ({
      is_deleted: false,
      checked_in_at: { not: null, gte: from, ...(to ? { lt: to } : {}) },
      ...(type ? { appointment_type: type } : {}),
      ...scope,
    });

    const [visitsCur, visitsPrev, followCur, followPrev, totalCur, totalPrev] =
      await db.$transaction([
        db.visit.count({ where: where(AppointmentType.VISIT, curStart) }),
        db.visit.count({
          where: where(AppointmentType.VISIT, prevStart, curStart),
        }),
        db.visit.count({ where: where(AppointmentType.FOLLOW_UP, curStart) }),
        db.visit.count({
          where: where(AppointmentType.FOLLOW_UP, prevStart, curStart),
        }),
        db.visit.count({ where: where(undefined, curStart) }),
        db.visit.count({ where: where(undefined, prevStart, curStart) }),
      ]);

    // Per-day series for the current month: bucket attended visits in memory
    // (per-branch monthly volume is modest; avoids a raw date_trunc query).
    const rows = await db.visit.findMany({
      where: where(undefined, curStart),
      select: { checked_in_at: true, appointment_type: true },
    });

    const buckets = new Map<string, { visits: number; follow_ups: number }>();
    for (const r of rows) {
      if (!r.checked_in_at) continue;
      const d = r.checked_in_at;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const bucket = buckets.get(key) ?? { visits: 0, follow_ups: 0 };
      if (r.appointment_type === AppointmentType.FOLLOW_UP) bucket.follow_ups++;
      else bucket.visits++;
      buckets.set(key, bucket);
    }

    const daily: VisitDailyPointDto[] = [...buckets.entries()]
      .map(([date, c]) => ({
        date,
        visits: c.visits,
        follow_ups: c.follow_ups,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      total: { current: totalCur, previous: totalPrev },
      visits: { current: visitsCur, previous: visitsPrev },
      follow_ups: { current: followCur, previous: followPrev },
      daily,
    };
  }
}
