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
      where: { id, organization_id: user.organizationId, is_deleted: false },
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
