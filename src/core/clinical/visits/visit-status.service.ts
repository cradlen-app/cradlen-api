import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Visit } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { assertStatusTransition } from '@common/utils/state-transition.js';
import { CLINICAL_EVENTS } from '@core/clinical/events/clinical-events.js';
import { UpdateVisitStatusDto } from './dto/update-visit-status.dto';
import { SetFollowUpDto } from './dto/set-follow-up.dto';
import {
  assertAssignedDoctor,
  assertReceptionAction,
} from './visit-actor.guards.js';
import {
  STATUS_TIMESTAMPS,
  TERMINAL_STATES,
  VALID_TRANSITIONS,
} from './visit-status.constants.js';

/**
 * Owns the visit-lifecycle state machine: status transitions (with their actor
 * guards and side effects — enrollment activation, the empty-journey cascade)
 * and follow-up scheduling. Split out of `VisitsService` so the lifecycle rules
 * live in one cohesive unit; the read + booking concerns stay in `VisitsService`.
 */
@Injectable()
export class VisitStatusService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Loads a visit with the journey context the lifecycle logic needs and
   * enforces org-scope (a visit outside the caller's org reads as not-found).
   */
  private async loadVisitForStatus(id: string, user: AuthContext) {
    const visit = await this.prismaService.db.visit.findUnique({
      where: { id, is_deleted: false },
      include: {
        episode: {
          select: {
            id: true,
            journey: {
              select: {
                id: true,
                organization_id: true,
                patient: { select: { id: true } },
              },
            },
          },
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

  async updateStatus(id: string, dto: UpdateVisitStatusDto, user: AuthContext) {
    const visit = await this.loadVisitForStatus(id, user);
    assertStatusTransition(
      VALID_TRANSITIONS,
      visit.status,
      dto.status,
      (current, next) => `Cannot transition from ${current} to ${next}`,
    );
    // Enforce *who* may drive each step: the assigned doctor starts the
    // consultation (IN_CONSULTATION) and completes it; reception drives the
    // queue — checks in, moves to IN_PROGRESS, cancels, marks no-show. Owners
    // and branch managers override either side.
    if (dto.status === 'IN_CONSULTATION' || dto.status === 'COMPLETED') {
      assertAssignedDoctor(visit.assigned_doctor_id, user);
    } else {
      assertReceptionAction(
        user,
        'Only reception can change this visit status',
      );
    }
    if (dto.status === 'COMPLETED') {
      const encounter = await this.prismaService.db.visitEncounter.findUnique({
        where: { visit_id: id },
        select: { chief_complaint: true, provisional_diagnosis: true },
      });
      if (!encounter || !encounter.chief_complaint?.trim()) {
        throw new BadRequestException(
          'Cannot complete visit without an encounter and a main complaint',
        );
      }
      if (!encounter.provisional_diagnosis?.trim()) {
        throw new BadRequestException(
          'Cannot complete visit without a provisional diagnosis',
        );
      }
    }
    const timestampField = STATUS_TIMESTAMPS[dto.status];
    const now = new Date();
    const isTerminal = dto.status === 'CANCELLED' || dto.status === 'NO_SHOW';

    // Journey id is already loaded via the include — no extra round-trip.
    const journeyId = visit.episode?.journey?.id;

    // The interactive transaction only earns its BEGIN/COMMIT round-trips when
    // there's a multi-write side effect: the terminal cancel/no-show cascade or
    // the CHECKED_IN enrollment activation. Every other transition is a single
    // row update — do it bare and skip the transaction overhead.
    const needsTransaction =
      (isTerminal && !!journeyId) || dto.status === 'CHECKED_IN';

    const updateData: Prisma.VisitUpdateInput = {
      status: dto.status,
      ...(timestampField ? { [timestampField]: now } : {}),
    };

    let updatedVisit: Visit;
    let cascaded = false;

    if (!needsTransaction) {
      updatedVisit = await this.prismaService.db.visit.update({
        where: { id },
        data: updateData,
      });
    } else {
      ({ updatedVisit, cascaded } = await this.prismaService.db.$transaction(
        async (tx) => {
          const next = await tx.visit.update({
            where: { id },
            data: updateData,
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

              const patientId = visit.episode?.journey?.patient?.id;
              const orgId = visit.episode?.journey?.organization_id;
              if (patientId && orgId) {
                await tx.patientOrgEnrollment.updateMany({
                  where: {
                    patient_id: patientId,
                    organization_id: orgId,
                    status: 'PENDING',
                    is_deleted: false,
                  },
                  data: { is_deleted: true, deleted_at: now },
                });
                await tx.$executeRaw`
                UPDATE "patients" SET is_deleted = true, deleted_at = NOW()
                WHERE id = ${patientId}::uuid
                AND NOT EXISTS (
                  SELECT 1 FROM "patient_journeys"
                  WHERE patient_id = ${patientId}::uuid AND is_deleted = false
                )
              `;
              }
            }
          }

          if (dto.status === 'CHECKED_IN') {
            const patientId = visit.episode?.journey?.patient?.id;
            const organizationId = visit.episode?.journey?.organization_id;
            if (patientId && organizationId) {
              await tx.patientOrgEnrollment.updateMany({
                where: {
                  patient_id: patientId,
                  organization_id: organizationId,
                  status: 'PENDING',
                  is_deleted: false,
                },
                data: { status: 'ACTIVE', activated_at: now },
              });
            }
          }

          return { updatedVisit: next, cascaded: didCascade };
        },
      ));
    }

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

  async setFollowUp(id: string, dto: SetFollowUpDto, user: AuthContext) {
    const visit = await this.loadVisitForStatus(id, user);
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
