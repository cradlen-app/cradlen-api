import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Medication, Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthorizationService } from '@core/auth/authorization/authorization.service';
import { MedicalRepService } from '@core/clinical/medical-rep/medical-rep.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { paginated } from '@common/utils/pagination.utils';
import { CreateMedicationDto } from './dto/create-medication.dto';
import { UpdateMedicationDto } from './dto/update-medication.dto';
import { ListMedicationsQueryDto } from './dto/list-medications-query.dto';
import { MedicationPrescriberDto } from './dto/medication.dto';
import {
  orgScopedReadFilter,
  assertOrgMutable,
  assertOrgReferenceable,
} from '../shared/org-scoped-catalog.js';

type MedicationStats = {
  total_prescriptions: number;
  top_prescribers: MedicationPrescriberDto[];
};

@Injectable()
export class MedicationsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly medicalRepService: MedicalRepService,
  ) {}

  async findAll(query: ListMedicationsQueryDto, user: AuthContext) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const where: Prisma.MedicationWhereInput = {
      is_deleted: false,
      AND: [
        orgScopedReadFilter(user.organizationId),
        ...(query.search
          ? [
              {
                OR: [
                  {
                    name: {
                      contains: query.search,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    generic_name: {
                      contains: query.search,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    code: {
                      contains: query.search,
                      mode: 'insensitive' as const,
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };

    const [items, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.medication.findMany({
        where,
        orderBy: [
          { organization_id: { sort: 'asc', nulls: 'first' } },
          { name: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaService.db.medication.count({ where }),
    ]);
    if (items.length === 0) return paginated([], { page, limit, total });

    const ids = items.map((m) => m.id);
    const stats = await this.gatherStats(ids, user.organizationId);
    const repsByMed = await this.medicalRepService.findRepsByMedicationIds(
      ids,
      user.organizationId,
    );

    const enriched = items.map((m) => ({
      ...m,
      total_prescriptions: stats.get(m.id)?.total_prescriptions ?? 0,
      top_prescribers: stats.get(m.id)?.top_prescribers ?? [],
      medical_reps: repsByMed.get(m.id) ?? [],
    }));

    return paginated(enriched, { page, limit, total });
  }

  async create(dto: CreateMedicationDto, user: AuthContext) {
    const existing = await this.prismaService.db.medication.findFirst({
      where: {
        organization_id: user.organizationId,
        code: dto.code,
        is_deleted: false,
      },
    });
    if (existing) {
      throw new ConflictException(
        `Medication with code "${dto.code}" already exists in this organization`,
      );
    }

    const medication = await this.prismaService.db.medication.create({
      data: {
        organization_id: user.organizationId,
        code: dto.code,
        name: dto.name,
        generic_name: dto.generic_name ?? null,
        form: dto.form ?? null,
        strength: dto.strength ?? null,
        category: dto.category ?? null,
        company: dto.company ?? null,
        notes: dto.notes ?? null,
        default_dose_amount: dto.default_dose_amount ?? null,
        default_dose_unit: dto.default_dose_unit ?? null,
        default_dose_frequency: dto.default_dose_frequency ?? null,
        default_dose_route: dto.default_dose_route ?? null,
        added_by_id: user.profileId,
      },
    });
    if (dto.medical_rep_id) {
      await this.medicalRepService.setMedicationRep(
        medication.id,
        dto.medical_rep_id,
        user.organizationId,
      );
    }
    return medication;
  }

  async update(id: string, dto: UpdateMedicationDto, user: AuthContext) {
    const med = await this.assertOrgScoped(id, user);
    const isOwner = await this.authorizationService.isOwner(
      user.profileId,
      user.organizationId,
    );
    if (!isOwner && med.added_by_id !== user.profileId) {
      throw new ForbiddenException(
        'Only the OWNER or the original creator can edit this medication',
      );
    }
    // `medical_rep_id` is not a Medication column — it routes to the
    // MedicalRepMedication join table. Strip it before the Prisma update.
    const { medical_rep_id, ...scalars } = dto;
    // ValidationPipe runs with whitelist + forbidNonWhitelisted, so `scalars`
    // only contains declared keys. Prisma treats `undefined` as "skip" and
    // `null` as "clear", which matches the DTO's intent — pass through.
    const medication = await this.prismaService.db.medication.update({
      where: { id },
      data: scalars,
    });
    if (medical_rep_id !== undefined) {
      await this.medicalRepService.setMedicationRep(
        id,
        medical_rep_id,
        user.organizationId,
      );
    }
    return medication;
  }

  async remove(id: string, user: AuthContext) {
    await this.assertOrgScoped(id, user);
    await this.authorizationService.assertOwnerOnly(
      user.profileId,
      user.organizationId,
    );
    await this.prismaService.db.medication.update({
      where: { id },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  /**
   * Loads a medication and verifies the caller may mutate it: rejects global
   * rows with 400, hides cross-org rows behind 404. Returns the live row.
   */
  private async assertOrgScoped(
    id: string,
    user: AuthContext,
  ): Promise<Medication> {
    const med = await this.prismaService.db.medication.findUnique({
      where: { id, is_deleted: false },
    });
    assertOrgMutable(med, user.organizationId, {
      notFound: `Medication ${id} not found`,
      globalForbidden: 'Global medications cannot be modified or deleted',
    });
    return med;
  }

  private async gatherStats(
    medicationIds: string[],
    organizationId: string,
  ): Promise<Map<string, MedicationStats>> {
    const prescriptionItems =
      await this.prismaService.db.prescriptionItem.findMany({
        where: {
          medication_id: { in: medicationIds },
          is_deleted: false,
          prescription: {
            is_deleted: false,
            prescribed_by: { organization_id: organizationId },
          },
        },
        select: {
          medication_id: true,
          prescription: {
            select: {
              prescribed_by_id: true,
              prescribed_by: {
                select: {
                  user: { select: { first_name: true, last_name: true } },
                },
              },
            },
          },
        },
      });

    const prescribersByMed = new Map<
      string,
      Map<string, MedicationPrescriberDto>
    >();
    const totalByMed = new Map<string, number>();

    for (const item of prescriptionItems) {
      if (!item.medication_id) continue;
      const medId = item.medication_id;
      const profileId = item.prescription.prescribed_by_id;
      const { first_name, last_name } = item.prescription.prescribed_by.user;

      totalByMed.set(medId, (totalByMed.get(medId) ?? 0) + 1);

      if (!prescribersByMed.has(medId)) prescribersByMed.set(medId, new Map());
      const pm = prescribersByMed.get(medId)!;
      if (!pm.has(profileId)) {
        pm.set(profileId, {
          profile_id: profileId,
          full_name: `${first_name} ${last_name}`,
          count: 0,
        });
      }
      pm.get(profileId)!.count++;
    }

    const result = new Map<string, MedicationStats>();
    for (const medId of medicationIds) {
      const prescriberMap = prescribersByMed.get(medId);
      const top_prescribers = prescriberMap
        ? [...prescriberMap.values()]
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
        : [];
      result.set(medId, {
        total_prescriptions: totalByMed.get(medId) ?? 0,
        top_prescribers,
      });
    }

    return result;
  }

  /**
   * Asserts a medication is referenceable by the caller (global or same org).
   * Used by prescriptions to validate medication_id before linking.
   */
  async assertReferenceable(medicationId: string, user: AuthContext) {
    const med = await this.prismaService.db.medication.findUnique({
      where: { id: medicationId, is_deleted: false },
      select: { organization_id: true },
    });
    assertOrgReferenceable(
      med,
      user.organizationId,
      `Medication ${medicationId} is not available to this organization`,
    );
  }
}
