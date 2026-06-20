import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { paginated } from '@common/utils/pagination.utils';
import { assertMedicationsExistInOrg } from './medical-rep.helpers.js';

export type MedicalRepSummary = {
  id: string;
  full_name: string;
  company_name: string;
};

/**
 * Medical-rep identity (search/lookup) and the rep↔medication catalog links.
 * The visit lifecycle (booking, queues, status) lives in
 * `MedicalRepVisitService`.
 */
@Injectable()
export class MedicalRepService {
  constructor(private readonly prismaService: PrismaService) {}

  /** Owners and branch managers see every rep in the org. */
  private isManagerRole(user: AuthContext): boolean {
    return user.role === 'OWNER' || user.role === 'BRANCH_MANAGER';
  }

  /**
   * Rep visibility scope. Managers see all org reps; everyone else (a clinical
   * doctor) sees only reps they have a visit assigned to them with — a non-doctor
   * matches nothing, which is the safe default.
   */
  private repScopeFilter(user: AuthContext): Prisma.MedicalRepWhereInput {
    return this.isManagerRole(user)
      ? {}
      : { visits: { some: { assigned_doctor_id: user.profileId } } };
  }

  async searchReps(
    user: AuthContext,
    query: { search?: string; page?: number; limit?: number },
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.MedicalRepWhereInput = {
      organization_id: user.organizationId,
      is_deleted: false,
      ...this.repScopeFilter(user),
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
          specialty_focus: true,
          medications: {
            where: { medication: { is_deleted: false } },
            select: { medication: { select: { name: true } } },
          },
        },
      }),
      this.prismaService.db.medicalRep.count({ where }),
    ]);
    // Visit count + latest visit date in one aggregate instead of a per-row
    // relation read plus a separate _count.
    const repIds = reps.map((r) => r.id);
    const visitStats = repIds.length
      ? await this.prismaService.db.medicalRepVisit.groupBy({
          by: ['medical_rep_id'],
          where: {
            medical_rep_id: { in: repIds },
            is_deleted: false,
            // A doctor's count/last-visit reflect their OWN visits with the rep.
            ...(this.isManagerRole(user)
              ? {}
              : { assigned_doctor_id: user.profileId }),
          },
          _count: { _all: true },
          _max: { scheduled_at: true },
        })
      : [];
    const statsByRep = new Map(visitStats.map((s) => [s.medical_rep_id, s]));
    const items = reps.map((rep) => {
      const stat = statsByRep.get(rep.id);
      return {
        id: rep.id,
        full_name: rep.full_name,
        company_name: rep.company_name,
        national_id: rep.national_id,
        phone_number: rep.phone_number,
        specialty_focus: rep.specialty_focus,
        products: rep.medications.map((m) => m.medication.name),
        last_visit_date: stat?._max.scheduled_at?.toISOString() ?? null,
        visits_count: stat?._count._all ?? 0,
      };
    });
    return paginated(items, { page, limit, total });
  }

  async findCompanies(
    search: string,
    organizationId: string,
  ): Promise<string[]> {
    const rows = await this.prismaService.db.medicalRep.findMany({
      where: {
        organization_id: organizationId,
        is_deleted: false,
        ...(search
          ? { company_name: { contains: search, mode: 'insensitive' } }
          : {}),
      },
      select: { company_name: true },
      distinct: ['company_name'],
      orderBy: { company_name: 'asc' },
      take: 20,
    });
    return rows.map((r) => r.company_name).filter((n): n is string => !!n);
  }

  async findOne(id: string, user: AuthContext) {
    const rep = await this.prismaService.db.medicalRep.findFirst({
      where: {
        id,
        organization_id: user.organizationId,
        is_deleted: false,
        ...this.repScopeFilter(user),
      },
    });
    if (!rep) throw new NotFoundException(`Medical rep ${id} not found`);
    return rep;
  }

  async listMedicationsForRep(repId: string, user: AuthContext) {
    await this.assertRepInOrg(repId, user.organizationId);
    const links = await this.prismaService.db.medicalRepMedication.findMany({
      where: { medical_rep_id: repId, medication: { is_deleted: false } },
      select: {
        medication: { select: { id: true, code: true, name: true } },
      },
      orderBy: { medication: { name: 'asc' } },
    });
    return links.map((l) => ({
      medication_id: l.medication.id,
      code: l.medication.code,
      name: l.medication.name,
    }));
  }

  async replaceMedicationsForRep(
    repId: string,
    medicationIds: string[],
    user: AuthContext,
  ) {
    await this.assertRepInOrg(repId, user.organizationId);
    if (medicationIds.length) {
      await assertMedicationsExistInOrg(
        this.prismaService.db,
        medicationIds,
        user.organizationId,
      );
    }
    await this.prismaService.db.$transaction(async (tx) => {
      await tx.medicalRepMedication.deleteMany({
        where: { medical_rep_id: repId },
      });
      if (medicationIds.length) {
        await tx.medicalRepMedication.createMany({
          data: medicationIds.map((mid) => ({
            medical_rep_id: repId,
            medication_id: mid,
          })),
        });
      }
    });
    return this.listMedicationsForRep(repId, user);
  }

  async unlinkMedicationFromRep(
    repId: string,
    medicationId: string,
    user: AuthContext,
  ) {
    await this.assertRepInOrg(repId, user.organizationId);
    await this.prismaService.db.medicalRepMedication.deleteMany({
      where: { medical_rep_id: repId, medication_id: medicationId },
    });
  }

  /**
   * Sets the single supplier rep for a medication (medication-side of the
   * `MedicalRepMedication` link). Replaces any existing links for the
   * medication; a `null` rep clears the link. Validates the rep is in the org.
   */
  async setMedicationRep(
    medicationId: string,
    medicalRepId: string | null,
    organizationId: string,
  ) {
    await this.prismaService.db.$transaction(async (tx) => {
      await tx.medicalRepMedication.deleteMany({
        where: { medication_id: medicationId },
      });
      if (medicalRepId) {
        const rep = await tx.medicalRep.findFirst({
          where: {
            id: medicalRepId,
            organization_id: organizationId,
            is_deleted: false,
          },
          select: { id: true },
        });
        if (!rep) {
          throw new NotFoundException(`Medical rep ${medicalRepId} not found`);
        }
        await tx.medicalRepMedication.create({
          data: { medical_rep_id: medicalRepId, medication_id: medicationId },
        });
      }
    });
  }

  /**
   * Public surface for cross-module callers (e.g. medications listing) that
   * need a med-id → reps map without depending on the link table directly.
   */
  async findRepsByMedicationIds(
    medicationIds: string[],
    organizationId: string,
  ) {
    if (!medicationIds.length) return new Map<string, MedicalRepSummary[]>();
    const links = await this.prismaService.db.medicalRepMedication.findMany({
      where: {
        medication_id: { in: medicationIds },
        medical_rep: { organization_id: organizationId, is_deleted: false },
      },
      select: {
        medication_id: true,
        medical_rep: {
          select: { id: true, full_name: true, company_name: true },
        },
      },
    });
    const result = new Map<string, MedicalRepSummary[]>();
    for (const link of links) {
      const bucket = result.get(link.medication_id) ?? [];
      bucket.push(link.medical_rep);
      result.set(link.medication_id, bucket);
    }
    return result;
  }

  private async assertRepInOrg(repId: string, organizationId: string) {
    const rep = await this.prismaService.db.medicalRep.findFirst({
      where: { id: repId, organization_id: organizationId, is_deleted: false },
      select: { id: true },
    });
    if (!rep) throw new NotFoundException(`Medical rep ${repId} not found`);
  }
}
