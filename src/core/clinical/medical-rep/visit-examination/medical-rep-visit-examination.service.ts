import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MedicalRepVisitStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { EventBus } from '@infrastructure/messaging/event-bus';
import { ERROR_CODES } from '@common/constant/error-codes';
import { assertMedicationsExistInOrg } from '../medical-rep.helpers.js';
import { UpdateMedicalRepVisitExaminationDto } from './dto/update-medical-rep-visit-examination.dto';

/** Closed statuses where the examination surface is read-only (edit blocked). */
const LOCKED_STATUSES = new Set<MedicalRepVisitStatus>([
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);

const VISIT_INCLUDE = {
  medical_rep: {
    include: {
      medications: {
        include: { medication: { select: { name: true } } },
      },
    },
  },
  medications: { select: { medication_id: true } },
} as const;

type VisitWithRel = Prisma.MedicalRepVisitGetPayload<{
  include: typeof VISIT_INCLUDE;
}>;

/**
 * Medical-rep visit "examination" surface — a single GET/PATCH envelope mirroring
 * the OB/GYN examination tab, but lighter: an optimistic/cache `examination_version`
 * token and a closed-visit lock, with no revision shadow tables or amendments
 * (rep visits are not a legal clinical record).
 *
 * The envelope folds in read-only rep `overview` context (name, company, specialty
 * focus, last completed visit, promoted medications) above the editable Visit fields
 * (purpose, products discussed, samples received, outcome, follow-up date, notes).
 */
@Injectable()
export class MedicalRepVisitExaminationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  private async loadVisit(
    id: string,
    user: AuthContext,
  ): Promise<VisitWithRel> {
    const visit = await this.prismaService.db.medicalRepVisit.findFirst({
      where: { id, organization_id: user.organizationId, is_deleted: false },
      include: VISIT_INCLUDE,
    });
    if (!visit) {
      throw new NotFoundException(`Medical rep visit ${id} not found`);
    }
    return visit;
  }

  async get(id: string, user: AuthContext) {
    const visit = await this.loadVisit(id, user);
    return this.composeEnvelope(visit);
  }

  private async composeEnvelope(visit: VisitWithRel) {
    // Most recent prior completed visit for the same rep (the Overview "last visit").
    const lastVisit = await this.prismaService.db.medicalRepVisit.findFirst({
      where: {
        medical_rep_id: visit.medical_rep_id,
        id: { not: visit.id },
        status: 'COMPLETED',
        is_deleted: false,
      },
      orderBy: { completed_at: 'desc' },
      select: { completed_at: true },
    });

    const visitMedIds = visit.medications.map((m) => m.medication_id);
    const promotedMedIds = visit.medical_rep.medications.map(
      (m) => m.medication_id,
    );
    // On a never-edited visit (version 1, no products yet) default the
    // "Products discussed" selection to the rep's promoted medicines, so the
    // doctor starts from the rep's catalog and trims down. Once edited (or
    // explicitly cleared), the stored set is authoritative.
    const medicationIds =
      visit.examination_version === 1 && visitMedIds.length === 0
        ? promotedMedIds
        : visitMedIds;

    return {
      visit_id: visit.id,
      examination_version: visit.examination_version,
      status: visit.status,
      updated_at: visit.updated_at,
      overview: {
        full_name: visit.medical_rep.full_name,
        company_name: visit.medical_rep.company_name,
        specialty_focus: visit.medical_rep.specialty_focus,
        last_visit_at: lastVisit?.completed_at?.toISOString() ?? null,
        promoted_medications: visit.medical_rep.medications.map(
          (m) => m.medication.name,
        ),
      },
      purpose: visit.purpose,
      samples_received: visit.samples_received,
      outcome: visit.outcome,
      follow_up_date: visit.follow_up_date?.toISOString() ?? null,
      notes: visit.notes,
      medication_ids: medicationIds,
    };
  }

  async patch(
    id: string,
    dto: UpdateMedicalRepVisitExaminationDto,
    user: AuthContext,
  ) {
    const visit = await this.loadVisit(id, user);
    if (LOCKED_STATUSES.has(visit.status)) {
      throw new ConflictException({
        code: ERROR_CODES.ENCOUNTER_LOCKED,
        message: `This medical-rep visit is ${visit.status.toLowerCase()} and can no longer be edited.`,
        details: { visit_id: id, status: visit.status },
      });
    }

    await this.prismaService.db.$transaction(async (tx) => {
      // Products discussed — replace the visit's medication set.
      if (dto.medication_ids !== undefined) {
        if (dto.medication_ids.length) {
          await assertMedicationsExistInOrg(
            tx,
            dto.medication_ids,
            user.organizationId,
          );
        }
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

      const data: Prisma.MedicalRepVisitUncheckedUpdateInput = {
        examination_version: { increment: 1 },
      };
      if (dto.purpose !== undefined) data.purpose = dto.purpose;
      if (dto.samples_received !== undefined) {
        data.samples_received = dto.samples_received;
      }
      if (dto.outcome !== undefined) data.outcome = dto.outcome;
      if (dto.follow_up_date !== undefined) {
        data.follow_up_date = dto.follow_up_date
          ? new Date(dto.follow_up_date)
          : null;
      }
      if (dto.notes !== undefined) data.notes = dto.notes;

      await tx.medicalRepVisit.update({ where: { id }, data });
    });

    this.eventBus.publish('medical_rep_visit.examination_updated', {
      organizationId: user.organizationId,
      branchId: visit.branch_id,
      assignedDoctorId: visit.assigned_doctor_id,
      visitId: id,
      updatedById: user.profileId,
    });

    const reloaded = await this.loadVisit(id, user);
    return this.composeEnvelope(reloaded);
  }
}
