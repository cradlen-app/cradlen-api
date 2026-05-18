import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CalendarEvent,
  CalendarEventType,
  CalendarVisibility,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { EventBus } from '@infrastructure/messaging/event-bus.js';
import { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto.js';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto.js';
import { ListCalendarEventsQueryDto } from './dto/list-calendar-events.query.dto.js';
import { CalendarEventResponseDto } from './dto/calendar-event.response.dto.js';
import {
  CALENDAR_EVENTS,
  CalendarEventChangedPayload,
} from './calendar.events.js';

const DEFAULT_VISIBILITY: Record<CalendarEventType, CalendarVisibility> = {
  DAY_OFF: CalendarVisibility.ORGANIZATION,
  PROCEDURE: CalendarVisibility.ORGANIZATION,
  MEETING: CalendarVisibility.PRIVATE,
  GENERIC: CalendarVisibility.PRIVATE,
};

const EVENT_INCLUDE = {
  procedure: { select: { id: true, name: true } },
  patient: { select: { id: true, full_name: true } },
  assistants: {
    select: {
      profile_id: true,
      profile: {
        select: {
          id: true,
          user: { select: { first_name: true, last_name: true } },
        },
      },
    },
  },
} satisfies Prisma.CalendarEventInclude;

type CalendarEventWithRelations = Prisma.CalendarEventGetPayload<{
  include: typeof EVENT_INCLUDE;
}>;

@Injectable()
export class CalendarService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  async create(
    user: AuthContext,
    dto: CreateCalendarEventDto,
  ): Promise<CalendarEventResponseDto> {
    const startAt = new Date(dto.start_at);
    const endAt = new Date(dto.end_at);
    this.assertWindow(startAt, endAt);

    const visibility = dto.visibility ?? DEFAULT_VISIBILITY[dto.event_type];

    await this.assertEventConsistency(user, dto.event_type, {
      procedure_id: dto.procedure_id,
      patient_id: dto.patient_id,
      branch_id: dto.branch_id,
      assistant_profile_ids: dto.assistant_profile_ids,
    });

    const created = await this.prismaService.db.calendarEvent.create({
      data: {
        profile_id: user.profileId,
        organization_id: user.organizationId,
        branch_id: dto.branch_id ?? null,
        event_type: dto.event_type,
        visibility,
        title: dto.title,
        description: dto.description ?? null,
        start_at: startAt,
        end_at: endAt,
        all_day: dto.all_day ?? false,
        procedure_id: dto.procedure_id ?? null,
        patient_id: dto.patient_id ?? null,
        ...(dto.event_type === CalendarEventType.PROCEDURE &&
        dto.assistant_profile_ids?.length
          ? {
              assistants: {
                create: dto.assistant_profile_ids.map((pid) => ({
                  profile_id: pid,
                })),
              },
            }
          : {}),
      },
      include: EVENT_INCLUDE,
    });

    this.publish(CALENDAR_EVENTS.event.created, created);
    return this.toResponse(created);
  }

  async list(user: AuthContext, query: ListCalendarEventsQueryDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (!(to > from)) {
      throw new BadRequestException({
        message: 'to must be after from',
        details: { fields: { to: ['must be after from'] } },
      });
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const where: Prisma.CalendarEventWhereInput = {
      is_deleted: false,
      organization_id: user.organizationId,
      start_at: { lt: to },
      end_at: { gt: from },
      AND: [this.visibilityWhere(user)],
      ...(query.profile_id ? { profile_id: query.profile_id } : {}),
      ...(query.event_type ? { event_type: query.event_type } : {}),
      ...(query.branch_id ? { branch_id: query.branch_id } : {}),
      ...(query.visibility ? { visibility: query.visibility } : {}),
    };

    const [items, total] = await Promise.all([
      this.prismaService.db.calendarEvent.findMany({
        where,
        include: EVENT_INCLUDE,
        orderBy: { start_at: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaService.db.calendarEvent.count({ where }),
    ]);

    return paginated(
      items.map((row) => this.toResponse(row)),
      { page, limit, total },
    );
  }

  async findOne(
    user: AuthContext,
    id: string,
  ): Promise<CalendarEventResponseDto> {
    const event = await this.prismaService.db.calendarEvent.findFirst({
      where: {
        id,
        is_deleted: false,
        organization_id: user.organizationId,
        AND: [this.visibilityWhere(user)],
      },
      include: EVENT_INCLUDE,
    });
    if (!event) throw new NotFoundException('Calendar event not found');
    return this.toResponse(event);
  }

  async update(
    user: AuthContext,
    id: string,
    dto: UpdateCalendarEventDto,
  ): Promise<CalendarEventResponseDto> {
    const existing = await this.loadOwned(user, id);

    const nextType = dto.event_type ?? existing.event_type;
    const nextStart = dto.start_at ? new Date(dto.start_at) : existing.start_at;
    const nextEnd = dto.end_at ? new Date(dto.end_at) : existing.end_at;
    this.assertWindow(nextStart, nextEnd);

    const touchesRelations =
      dto.event_type !== undefined ||
      dto.procedure_id !== undefined ||
      dto.patient_id !== undefined ||
      dto.branch_id !== undefined ||
      dto.assistant_profile_ids !== undefined;
    if (touchesRelations) {
      await this.assertEventConsistency(user, nextType, {
        procedure_id:
          dto.procedure_id !== undefined
            ? dto.procedure_id
            : (existing.procedure_id ?? undefined),
        patient_id:
          dto.patient_id !== undefined
            ? dto.patient_id
            : (existing.patient_id ?? undefined),
        branch_id:
          dto.branch_id !== undefined
            ? dto.branch_id
            : (existing.branch_id ?? undefined),
        assistant_profile_ids: dto.assistant_profile_ids,
      });
    }

    const updated = await this.prismaService.db.$transaction(async (tx) => {
      if (dto.assistant_profile_ids !== undefined) {
        await tx.calendarEventAssistant.deleteMany({
          where: { calendar_event_id: id },
        });
        if (
          nextType === CalendarEventType.PROCEDURE &&
          dto.assistant_profile_ids.length > 0
        ) {
          await tx.calendarEventAssistant.createMany({
            data: dto.assistant_profile_ids.map((pid) => ({
              calendar_event_id: id,
              profile_id: pid,
            })),
            skipDuplicates: true,
          });
        }
      } else if (
        nextType !== CalendarEventType.PROCEDURE &&
        existing.event_type === CalendarEventType.PROCEDURE
      ) {
        // Type changed away from PROCEDURE — drop any existing assistants
        await tx.calendarEventAssistant.deleteMany({
          where: { calendar_event_id: id },
        });
      }

      return tx.calendarEvent.update({
        where: { id },
        data: {
          ...(dto.event_type !== undefined
            ? { event_type: dto.event_type }
            : {}),
          ...(dto.visibility !== undefined
            ? { visibility: dto.visibility }
            : {}),
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.start_at !== undefined ? { start_at: nextStart } : {}),
          ...(dto.end_at !== undefined ? { end_at: nextEnd } : {}),
          ...(dto.all_day !== undefined ? { all_day: dto.all_day } : {}),
          ...(dto.branch_id !== undefined
            ? { branch_id: dto.branch_id ?? null }
            : {}),
          ...(dto.procedure_id !== undefined
            ? { procedure_id: dto.procedure_id ?? null }
            : {}),
          ...(dto.patient_id !== undefined
            ? { patient_id: dto.patient_id ?? null }
            : {}),
        },
        include: EVENT_INCLUDE,
      });
    });

    this.publish(CALENDAR_EVENTS.event.updated, updated);
    return this.toResponse(updated);
  }

  async remove(user: AuthContext, id: string): Promise<void> {
    const existing = await this.loadOwned(user, id);
    const deleted = await this.prismaService.db.calendarEvent.update({
      where: { id: existing.id },
      data: { is_deleted: true, deleted_at: new Date() },
      include: EVENT_INCLUDE,
    });
    this.publish(CALENDAR_EVENTS.event.deleted, deleted);
  }

  // ---------- internals ----------

  private assertWindow(start: Date, end: Date): void {
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid start_at or end_at');
    }
    if (!(end > start)) {
      throw new BadRequestException({
        message: 'end_at must be after start_at',
        details: { fields: { end_at: ['must be after start_at'] } },
      });
    }
  }

  private async assertEventConsistency(
    user: AuthContext,
    eventType: CalendarEventType,
    fields: {
      procedure_id?: string;
      patient_id?: string;
      branch_id?: string;
      assistant_profile_ids?: string[];
    },
  ): Promise<void> {
    if (eventType === CalendarEventType.PROCEDURE) {
      if (!fields.procedure_id) {
        throw new BadRequestException({
          message: 'procedure_id is required for PROCEDURE events',
          details: { fields: { procedure_id: ['is required'] } },
        });
      }
      const proc = await this.prismaService.db.procedure.findFirst({
        where: { id: fields.procedure_id, is_deleted: false },
        select: { id: true },
      });
      if (!proc) {
        throw new BadRequestException({
          message: 'procedure_id does not reference an active procedure',
          details: { fields: { procedure_id: ['not found'] } },
        });
      }
      if (fields.patient_id) {
        const patient = await this.prismaService.db.patient.findFirst({
          where: { id: fields.patient_id, is_deleted: false },
          select: {
            id: true,
            journeys: {
              where: { organization_id: user.organizationId },
              select: { id: true },
              take: 1,
            },
          },
        });
        if (!patient || patient.journeys.length === 0) {
          throw new BadRequestException({
            message: 'patient_id is not accessible to this organization',
            details: { fields: { patient_id: ['not found'] } },
          });
        }
      }
    } else {
      if (fields.procedure_id) {
        throw new BadRequestException({
          message: 'procedure_id is only valid for PROCEDURE events',
          details: {
            fields: { procedure_id: ['not allowed for this event type'] },
          },
        });
      }
      if (fields.patient_id) {
        throw new BadRequestException({
          message: 'patient_id is only valid for PROCEDURE events',
          details: {
            fields: { patient_id: ['not allowed for this event type'] },
          },
        });
      }
      if (
        fields.assistant_profile_ids &&
        fields.assistant_profile_ids.length > 0
      ) {
        throw new BadRequestException({
          message: 'assistant_profile_ids is only valid for PROCEDURE events',
          details: {
            fields: {
              assistant_profile_ids: ['not allowed for this event type'],
            },
          },
        });
      }
    }

    if (
      eventType === CalendarEventType.PROCEDURE &&
      fields.assistant_profile_ids &&
      fields.assistant_profile_ids.length > 0
    ) {
      const ids = Array.from(new Set(fields.assistant_profile_ids));
      if (ids.includes(user.profileId)) {
        throw new BadRequestException({
          message: 'You cannot list yourself as an assistant',
          details: {
            fields: {
              assistant_profile_ids: ['cannot include the event owner'],
            },
          },
        });
      }
      const profiles = await this.prismaService.db.profile.findMany({
        where: {
          id: { in: ids },
          organization_id: user.organizationId,
          is_deleted: false,
        },
        select: { id: true },
      });
      if (profiles.length !== ids.length) {
        throw new BadRequestException({
          message: 'One or more assistant profiles are not accessible',
          details: { fields: { assistant_profile_ids: ['not found'] } },
        });
      }
    }

    if (fields.branch_id) {
      const branch = await this.prismaService.db.branch.findFirst({
        where: {
          id: fields.branch_id,
          organization_id: user.organizationId,
          is_deleted: false,
        },
        select: { id: true },
      });
      if (!branch) {
        throw new BadRequestException({
          message: 'branch_id does not belong to this organization',
          details: { fields: { branch_id: ['not found'] } },
        });
      }
    }
  }

  private visibilityWhere(user: AuthContext): Prisma.CalendarEventWhereInput {
    const orgBranchClause: Prisma.CalendarEventWhereInput = {
      visibility: CalendarVisibility.ORGANIZATION,
      OR: [
        { branch_id: null },
        ...(user.branchIds.length > 0
          ? [{ branch_id: { in: user.branchIds } }]
          : []),
      ],
    };
    return {
      OR: [{ profile_id: user.profileId }, orgBranchClause],
    };
  }

  private async loadOwned(
    user: AuthContext,
    id: string,
  ): Promise<CalendarEvent> {
    const existing = await this.prismaService.db.calendarEvent.findFirst({
      where: { id, is_deleted: false, profile_id: user.profileId },
    });
    if (!existing) throw new NotFoundException('Calendar event not found');
    return existing;
  }

  private publish(eventName: string, row: CalendarEvent): void {
    const payload: CalendarEventChangedPayload = {
      id: row.id,
      profile_id: row.profile_id,
      organization_id: row.organization_id,
      event_type: row.event_type,
      visibility: row.visibility,
      branch_id: row.branch_id,
      start_at: row.start_at,
      end_at: row.end_at,
    };
    this.eventBus.publish(eventName, payload);
  }

  private toResponse(
    row: CalendarEventWithRelations,
  ): CalendarEventResponseDto {
    return {
      id: row.id,
      profile_id: row.profile_id,
      organization_id: row.organization_id,
      branch_id: row.branch_id,
      event_type: row.event_type,
      visibility: row.visibility,
      title: row.title,
      description: row.description,
      start_at: row.start_at,
      end_at: row.end_at,
      all_day: row.all_day,
      procedure_id: row.procedure_id,
      patient_id: row.patient_id,
      procedure_name: row.procedure?.name ?? null,
      patient_full_name: row.patient?.full_name ?? null,
      assistants: (row.assistants ?? []).map((a) => ({
        profile_id: a.profile_id,
        full_name:
          `${a.profile?.user?.first_name ?? ''} ${a.profile?.user?.last_name ?? ''}`.trim() ||
          a.profile_id,
      })),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
