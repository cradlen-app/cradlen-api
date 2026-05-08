import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import {
  CalendarEventType,
  CalendarParticipantRole,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { AuthContext } from '../../common/interfaces/auth-context.interface.js';
import { CalendarConflictsService } from './calendar-conflicts.service.js';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto.js';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto.js';
import { ListCalendarEventsQueryDto } from './dto/list-calendar-events.query.js';
import { CheckConflictsDto } from './dto/check-conflicts.dto.js';
import { ParticipantDto } from './dto/participant.dto.js';
import {
  LeaveDetailsDto,
  MeetingDetailsDto,
  PersonalDetailsDto,
  SurgeryDetailsDto,
} from './dto/details.dto.js';

const CREATE_ROLES = ['OWNER', 'DOCTOR'];

const eventInclude = {
  participants: {
    select: { id: true, profile_id: true, role: true },
  },
  patient: {
    select: { id: true, full_name: true },
  },
} satisfies Prisma.CalendarEventInclude;

@Injectable()
export class CalendarService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly conflictsService: CalendarConflictsService,
  ) {}

  async create(dto: CreateCalendarEventDto, user: AuthContext) {
    if (!user.roles.some((r) => CREATE_ROLES.includes(r))) {
      throw new ForbiddenException('Only OWNER or DOCTOR can create events');
    }

    const startsAt = new Date(dto.starts_at);
    const endsAt = new Date(dto.ends_at);
    if (endsAt <= startsAt) {
      throw new BadRequestException('ends_at must be after starts_at');
    }

    await this.validateDetails(dto.type, dto.details);
    const participants = dto.participants ?? [];
    this.validateParticipantsForType(dto.type, participants, user.profileId);

    if (dto.type === 'SURGERY') {
      if (!dto.branch_id) {
        throw new BadRequestException('branch_id is required for SURGERY');
      }
      if (!dto.patient_id) {
        throw new BadRequestException('patient_id is required for SURGERY');
      }
      await this.assertPatientInOrg(dto.patient_id, user.organizationId);
      await this.assertBranchInOrg(dto.branch_id, user.organizationId);
      this.assertCallerInBranch(user, dto.branch_id);
      await this.assertParticipantsInBranch(
        participants.map((p) => p.profile_id),
        dto.branch_id,
        user.organizationId,
      );
    } else if (dto.branch_id) {
      await this.assertBranchInOrg(dto.branch_id, user.organizationId);
    }

    if (participants.length) {
      await this.assertParticipantsInOrg(
        participants.map((p) => p.profile_id),
        user.organizationId,
      );
    }

    const event = await this.prismaService.db.calendarEvent.create({
      data: {
        organization_id: user.organizationId,
        branch_id: dto.branch_id ?? null,
        created_by_id: user.profileId,
        patient_id: dto.type === 'SURGERY' ? (dto.patient_id ?? null) : null,
        type: dto.type,
        title: dto.title,
        description: dto.description ?? null,
        starts_at: startsAt,
        ends_at: endsAt,
        all_day: dto.all_day ?? false,
        details: dto.details as Prisma.InputJsonValue,
        participants: participants.length
          ? {
              create: participants.map((p) => ({
                profile_id: p.profile_id,
                role: p.role,
              })),
            }
          : undefined,
      },
      include: eventInclude,
    });

    const conflicts = await this.conflictsService.findConflicts({
      organizationId: user.organizationId,
      startsAt,
      endsAt,
      participantProfileIds: this.collectInvolvedProfiles(
        user.profileId,
        participants,
      ),
      branchId: dto.branch_id,
      type: dto.type,
      excludeEventId: event.id,
    });

    return { event, conflicts };
  }

  async findAll(query: ListCalendarEventsQueryDto, user: AuthContext) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to <= from) {
      throw new BadRequestException('to must be after from');
    }

    const isOwner = user.roles.includes('OWNER');
    const visibility: Prisma.CalendarEventWhereInput = {
      AND: [
        {
          OR: [
            { type: { not: 'PERSONAL' } },
            { created_by_id: user.profileId },
          ],
        },
        ...(isOwner
          ? []
          : [
              {
                OR: [
                  { created_by_id: user.profileId },
                  {
                    participants: {
                      some: { profile_id: user.profileId },
                    },
                  },
                  {
                    branch_id: { in: user.branchIds },
                  },
                ],
              },
            ]),
      ],
    };

    return this.prismaService.db.calendarEvent.findMany({
      where: {
        is_deleted: false,
        organization_id: user.organizationId,
        starts_at: { lt: to },
        ends_at: { gt: from },
        ...(query.branch_id && { branch_id: query.branch_id }),
        ...(query.type && { type: query.type }),
        ...(query.patient_id && { patient_id: query.patient_id }),
        ...(query.doctor_id && {
          OR: [
            { created_by_id: query.doctor_id },
            {
              participants: {
                some: {
                  profile_id: query.doctor_id,
                  role: 'PRIMARY_DOCTOR',
                },
              },
            },
          ],
        }),
        ...visibility,
      },
      orderBy: { starts_at: 'asc' },
      include: eventInclude,
    });
  }

  async findOne(id: string, user: AuthContext) {
    const event = await this.prismaService.db.calendarEvent.findFirst({
      where: {
        id,
        is_deleted: false,
        organization_id: user.organizationId,
        ...this.visibilityFilter(user),
      },
      include: eventInclude,
    });
    if (!event) throw new NotFoundException(`Calendar event ${id} not found`);
    return event;
  }

  async update(id: string, dto: UpdateCalendarEventDto, user: AuthContext) {
    const existing = await this.assertCreator(id, user);

    if (dto.details) {
      await this.validateDetails(existing.type, dto.details);
    }
    const participants = dto.participants;
    if (participants) {
      this.validateParticipantsForType(
        existing.type,
        participants,
        existing.created_by_id,
      );
      await this.assertParticipantsInOrg(
        participants.map((p) => p.profile_id),
        user.organizationId,
      );
    }

    const startsAt = dto.starts_at
      ? new Date(dto.starts_at)
      : existing.starts_at;
    const endsAt = dto.ends_at ? new Date(dto.ends_at) : existing.ends_at;
    if (endsAt <= startsAt) {
      throw new BadRequestException('ends_at must be after starts_at');
    }

    const branchId =
      dto.branch_id !== undefined ? dto.branch_id : existing.branch_id;
    if (existing.type === 'SURGERY' && !branchId) {
      throw new BadRequestException('branch_id is required for SURGERY');
    }
    if (branchId && branchId !== existing.branch_id) {
      await this.assertBranchInOrg(branchId, user.organizationId);
    }

    const event = await this.prismaService.db.$transaction(async (tx) => {
      if (participants) {
        await tx.calendarEventParticipant.deleteMany({
          where: { event_id: id },
        });
      }
      return tx.calendarEvent.update({
        where: { id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(dto.starts_at !== undefined && { starts_at: startsAt }),
          ...(dto.ends_at !== undefined && { ends_at: endsAt }),
          ...(dto.all_day !== undefined && { all_day: dto.all_day }),
          ...(dto.branch_id !== undefined && { branch_id: dto.branch_id }),
          ...(existing.type === 'SURGERY' &&
            dto.patient_id !== undefined && { patient_id: dto.patient_id }),
          ...(dto.details && {
            details: dto.details as Prisma.InputJsonValue,
          }),
          ...(participants && {
            participants: {
              create: participants.map((p) => ({
                profile_id: p.profile_id,
                role: p.role,
              })),
            },
          }),
        },
        include: eventInclude,
      });
    });

    const involvedIds = this.collectInvolvedProfiles(
      event.created_by_id,
      event.participants.map((p) => ({
        profile_id: p.profile_id,
        role: p.role,
      })),
    );
    const conflicts = await this.conflictsService.findConflicts({
      organizationId: user.organizationId,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      participantProfileIds: involvedIds,
      branchId: event.branch_id,
      type: event.type,
      excludeEventId: event.id,
    });

    return { event, conflicts };
  }

  async cancel(id: string, user: AuthContext) {
    await this.assertCreator(id, user);
    return this.prismaService.db.calendarEvent.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: eventInclude,
    });
  }

  async remove(id: string, user: AuthContext) {
    await this.assertCreator(id, user);
    await this.prismaService.db.calendarEvent.update({
      where: { id },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  async checkConflicts(dto: CheckConflictsDto, user: AuthContext) {
    const startsAt = new Date(dto.starts_at);
    const endsAt = new Date(dto.ends_at);
    if (endsAt <= startsAt) {
      throw new BadRequestException('ends_at must be after starts_at');
    }
    if (dto.participant_profile_ids.length) {
      await this.assertParticipantsInOrg(
        dto.participant_profile_ids,
        user.organizationId,
      );
    }
    const conflicts = await this.conflictsService.findConflicts({
      organizationId: user.organizationId,
      startsAt,
      endsAt,
      participantProfileIds: dto.participant_profile_ids,
      excludeEventId: dto.exclude_event_id,
    });
    return { conflicts };
  }

  private async assertCreator(id: string, user: AuthContext) {
    const event = await this.prismaService.db.calendarEvent.findFirst({
      where: {
        id,
        is_deleted: false,
        organization_id: user.organizationId,
      },
      include: eventInclude,
    });
    if (!event) throw new NotFoundException(`Calendar event ${id} not found`);
    if (event.created_by_id !== user.profileId) {
      throw new ForbiddenException('Only the creator can modify this event');
    }
    return event;
  }

  private visibilityFilter(user: AuthContext): Prisma.CalendarEventWhereInput {
    const isOwner = user.roles.includes('OWNER');
    return {
      AND: [
        {
          OR: [
            { type: { not: 'PERSONAL' } },
            { created_by_id: user.profileId },
          ],
        },
        ...(isOwner
          ? []
          : [
              {
                OR: [
                  { created_by_id: user.profileId },
                  {
                    participants: {
                      some: { profile_id: user.profileId },
                    },
                  },
                  { branch_id: { in: user.branchIds } },
                ],
              },
            ]),
      ],
    };
  }

  private collectInvolvedProfiles(
    creatorProfileId: string,
    participants: Array<{ profile_id: string; role: CalendarParticipantRole }>,
  ): string[] {
    const ids = new Set<string>([creatorProfileId]);
    for (const p of participants) ids.add(p.profile_id);
    return [...ids];
  }

  private validateParticipantsForType(
    type: CalendarEventType,
    participants: ParticipantDto[],
    creatorProfileId: string,
  ) {
    if (type === 'PERSONAL' || type === 'LEAVE') {
      if (participants.length) {
        throw new BadRequestException(
          `${type} events do not accept participants`,
        );
      }
      return;
    }
    if (type === 'SURGERY') {
      const primary = participants.filter((p) => p.role === 'PRIMARY_DOCTOR');
      if (primary.length !== 1) {
        throw new BadRequestException(
          'SURGERY requires exactly one PRIMARY_DOCTOR participant',
        );
      }
      const invalidRole = participants.find(
        (p) => p.role !== 'PRIMARY_DOCTOR' && p.role !== 'ASSISTANT',
      );
      if (invalidRole) {
        throw new BadRequestException(
          'SURGERY participants must be PRIMARY_DOCTOR or ASSISTANT',
        );
      }
    }
    if (type === 'MEETING') {
      const invalidRole = participants.find((p) => p.role !== 'ATTENDEE');
      if (invalidRole) {
        throw new BadRequestException(
          'MEETING participants must have ATTENDEE role',
        );
      }
    }
    const seen = new Set<string>();
    for (const p of participants) {
      if (p.profile_id === creatorProfileId) continue;
      if (seen.has(p.profile_id)) {
        throw new BadRequestException('Duplicate participant');
      }
      seen.add(p.profile_id);
    }
  }

  private async validateDetails(
    type: CalendarEventType,
    details: Record<string, unknown>,
  ) {
    const dtoClass = {
      SURGERY: SurgeryDetailsDto,
      MEETING: MeetingDetailsDto,
      PERSONAL: PersonalDetailsDto,
      LEAVE: LeaveDetailsDto,
    }[type];
    const instance = plainToInstance(dtoClass, details ?? {});
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length) {
      throw new BadRequestException({
        message: `Invalid details for ${type}`,
        details: { fields: this.flattenValidationErrors(errors) },
      });
    }
  }

  private flattenValidationErrors(
    errors: ValidationError[],
  ): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const err of errors) {
      if (err.constraints) {
        result[err.property] = Object.values(err.constraints);
      }
    }
    return result;
  }

  private async assertPatientInOrg(patientId: string, organizationId: string) {
    const patient = await this.prismaService.db.patient.findFirst({
      where: {
        id: patientId,
        is_deleted: false,
        journeys: { some: { organization_id: organizationId } },
      },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException(`Patient ${patientId} not found`);
  }

  private async assertBranchInOrg(branchId: string, organizationId: string) {
    const branch = await this.prismaService.db.branch.findFirst({
      where: {
        id: branchId,
        organization_id: organizationId,
        is_deleted: false,
      },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException(`Branch ${branchId} not found`);
  }

  private assertCallerInBranch(user: AuthContext, branchId: string) {
    if (user.roles.includes('OWNER')) return;
    if (!user.branchIds.includes(branchId)) {
      throw new ForbiddenException('You do not have access to this branch');
    }
  }

  private async assertParticipantsInOrg(
    profileIds: string[],
    organizationId: string,
  ) {
    if (!profileIds.length) return;
    const count = await this.prismaService.db.profile.count({
      where: {
        id: { in: profileIds },
        organization_id: organizationId,
        is_active: true,
        is_deleted: false,
      },
    });
    if (count !== new Set(profileIds).size) {
      throw new BadRequestException('One or more participants are invalid');
    }
  }

  private async assertParticipantsInBranch(
    profileIds: string[],
    branchId: string,
    organizationId: string,
  ) {
    if (!profileIds.length) return;
    const count = await this.prismaService.db.profileBranch.count({
      where: {
        profile_id: { in: profileIds },
        branch_id: branchId,
        organization_id: organizationId,
      },
    });
    if (count !== new Set(profileIds).size) {
      throw new BadRequestException(
        'All surgery participants must belong to the event branch',
      );
    }
  }
}
