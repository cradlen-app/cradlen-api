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
import {
  ProductDiscussedDto,
  UpdateMedicalRepVisitExaminationDto,
} from './dto/update-medical-rep-visit-examination.dto';

/** Closed statuses where the examination surface is read-only (edit blocked). */
const LOCKED_STATUSES = new Set<MedicalRepVisitStatus>([
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);

/** Derive a stable upper-snake catalog code from a free-typed name. */
function slugifyCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

const VISIT_INCLUDE = {
  medical_rep: {
    include: {
      medications: {
        include: { medication: { select: { name: true } } },
      },
    },
  },
  medications: {
    include: { medication: { select: { name: true } } },
  },
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

    const visitMeds = visit.medications.map((m) => ({
      id: m.medication_id,
      name: m.medication.name,
    }));
    const promotedMeds = visit.medical_rep.medications.map((m) => ({
      id: m.medication_id,
      name: m.medication.name,
    }));
    // On a never-edited visit (version 1, no products yet) default the
    // "Products discussed" selection to the rep's promoted medicines, so the
    // doctor starts from the rep's catalog and trims down. Once edited (or
    // explicitly cleared), the stored set is authoritative.
    const discussedMedications =
      visit.examination_version === 1 && visitMeds.length === 0
        ? promotedMeds
        : visitMeds;

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
        promoted_medications: promotedMeds.map((m) => m.name),
      },
      purpose: visit.purpose,
      samples_received: visit.samples_received,
      outcome: visit.outcome,
      follow_up_date: visit.follow_up_date?.toISOString() ?? null,
      notes: visit.notes,
      discussed_medications: discussedMedications,
    };
  }

  /**
   * Resolve each "product discussed" row to a Medication id: use the supplied
   * `medication_id` when present (verified in-org), otherwise resolve-or-create
   * an org-scoped catalog Medication from the typed name (slug `code`, tagged
   * with `added_by_id`). Mirrors `linkNovelLabTests` in the OB/GYN examination.
   * Returns deduped ids.
   */
  private async resolveProductMedicationIds(
    tx: Prisma.TransactionClient,
    products: ProductDiscussedDto[],
    orgId: string,
    profileId: string,
  ): Promise<string[]> {
    const ids = new Set<string>();
    const providedIds: string[] = [];
    const cache = new Map<string, string>(); // code → resolved id

    for (const product of products) {
      if (product.medication_id) {
        providedIds.push(product.medication_id);
        ids.add(product.medication_id);
        continue;
      }
      const name = product.name?.trim();
      if (!name) continue;
      const code = slugifyCode(name);
      if (!code) continue;

      const cached = cache.get(code);
      if (cached) {
        ids.add(cached);
        continue;
      }

      const existing = await tx.medication.findFirst({
        where: {
          is_deleted: false,
          AND: [
            { OR: [{ organization_id: null }, { organization_id: orgId }] },
            { OR: [{ code }, { name: { equals: name, mode: 'insensitive' } }] },
          ],
        },
        select: { id: true },
      });
      let mid = existing?.id;
      if (!mid) {
        try {
          const created = await tx.medication.create({
            data: {
              organization_id: orgId,
              code,
              name,
              added_by_id: profileId,
            },
            select: { id: true },
          });
          mid = created.id;
        } catch (err) {
          // Concurrent create on the (organization_id, code) unique → refetch.
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            const refetched = await tx.medication.findFirst({
              where: { organization_id: orgId, code },
              select: { id: true },
            });
            mid = refetched?.id;
          } else {
            throw err;
          }
        }
      }
      if (mid) {
        cache.set(code, mid);
        ids.add(mid);
      }
    }

    if (providedIds.length) {
      await assertMedicationsExistInOrg(tx, providedIds, orgId);
    }
    return [...ids];
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
      // Products discussed — resolve/create the meds, replace the visit's set,
      // and auto-add them to the rep's promoted list (additive).
      if (dto.products !== undefined) {
        const medIds = await this.resolveProductMedicationIds(
          tx,
          dto.products,
          user.organizationId,
          user.profileId,
        );
        await tx.medicalRepVisitMedication.deleteMany({
          where: { medical_rep_visit_id: id },
        });
        if (medIds.length) {
          await tx.medicalRepVisitMedication.createMany({
            data: medIds.map((mid) => ({
              medical_rep_visit_id: id,
              medication_id: mid,
            })),
          });
          await tx.medicalRepMedication.createMany({
            data: medIds.map((mid) => ({
              medical_rep_id: visit.medical_rep_id,
              medication_id: mid,
            })),
            skipDuplicates: true,
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
