import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthorizationService } from '@core/auth/authorization/authorization.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { paginated } from '@common/utils/pagination.utils';
import { CreateMedicationDto } from './dto/create-medication.dto';
import { UpdateMedicationDto } from './dto/update-medication.dto';
import { ListMedicationsQueryDto } from './dto/list-medications-query.dto';
import {
  MedicationPrescriberDto,
  MedicalRepLinkDto,
} from './dto/medication.dto';

@Injectable()
export class MedicationsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async findAll(query: ListMedicationsQueryDto, user: AuthContext) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    if (query.medical_rep_id) {
      const rep = await this.prismaService.db.medicalRep.findFirst({
        where: {
          id: query.medical_rep_id,
          organization_id: user.organizationId,
          is_deleted: false,
        },
        select: { id: true },
      });
      if (!rep) {
        throw new BadRequestException(
          `Medical rep ${query.medical_rep_id} is not available to this organization`,
        );
      }
    }

    const where: Prisma.MedicationWhereInput = {
      is_deleted: false,
      AND: [
        {
          OR: [
            { organization_id: null },
            { organization_id: user.organizationId },
          ],
        },
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
      ...(query.medical_rep_id && {
        medical_rep_links: {
          some: { medical_rep_id: query.medical_rep_id },
        },
      }),
    };

    const [items, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.medication.findMany({
        where,
        orderBy: [{ organization_id: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaService.db.medication.count({ where }),
    ]);
    if (items.length === 0) return paginated([], { page, limit, total });

    const medicationIds = items.map((m) => m.id);
    const stats = await this.gatherStats(medicationIds, user.organizationId);

    const enriched = items.map((m) => ({
      ...m,
      total_prescriptions: stats.get(m.id)?.total_prescriptions ?? 0,
      top_prescribers: stats.get(m.id)?.top_prescribers ?? [],
      medical_reps: stats.get(m.id)?.medical_reps ?? [],
    }));

    return paginated(enriched, { page, limit, total });
  }

  async create(dto: CreateMedicationDto, user: AuthContext) {
    const existing = await this.prismaService.db.medication.findFirst({
      where: { organization_id: user.organizationId, code: dto.code },
    });
    if (existing) {
      throw new ConflictException(
        `Medication with code "${dto.code}" already exists in this organization`,
      );
    }
    return this.prismaService.db.medication.create({
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
  }

  async update(id: string, dto: UpdateMedicationDto, user: AuthContext) {
    const med = await this.prismaService.db.medication.findUnique({
      where: { id, is_deleted: false },
    });
    if (!med) throw new NotFoundException(`Medication ${id} not found`);
    if (med.organization_id === null) {
      throw new BadRequestException('Global medications cannot be modified');
    }
    if (med.organization_id !== user.organizationId) {
      throw new NotFoundException(`Medication ${id} not found`);
    }
    const isOwner = await this.authorizationService.isOwner(
      user.profileId,
      user.organizationId,
    );
    if (!isOwner && med.added_by_id !== user.profileId) {
      throw new ForbiddenException(
        'Only the OWNER or the original creator can edit this medication',
      );
    }
    return this.prismaService.db.medication.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.generic_name !== undefined && { generic_name: dto.generic_name }),
        ...(dto.form !== undefined && { form: dto.form }),
        ...(dto.strength !== undefined && { strength: dto.strength }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.company !== undefined && { company: dto.company }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.default_dose_amount !== undefined && { default_dose_amount: dto.default_dose_amount }),
        ...(dto.default_dose_unit !== undefined && { default_dose_unit: dto.default_dose_unit }),
        ...(dto.default_dose_frequency !== undefined && { default_dose_frequency: dto.default_dose_frequency }),
        ...(dto.default_dose_route !== undefined && { default_dose_route: dto.default_dose_route }),
      },
    });
  }

  async remove(id: string, user: AuthContext) {
    const med = await this.prismaService.db.medication.findUnique({
      where: { id, is_deleted: false },
    });
    if (!med) throw new NotFoundException(`Medication ${id} not found`);
    if (med.organization_id === null) {
      throw new BadRequestException('Global medications cannot be deleted');
    }
    if (med.organization_id !== user.organizationId) {
      throw new NotFoundException(`Medication ${id} not found`);
    }
    await this.authorizationService.assertOwnerOnly(
      user.profileId,
      user.organizationId,
    );
    await this.prismaService.db.medication.update({
      where: { id },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  private async gatherStats(
    medicationIds: string[],
    organizationId: string,
  ): Promise<
    Map<
      string,
      {
        total_prescriptions: number;
        top_prescribers: MedicationPrescriberDto[];
        medical_reps: MedicalRepLinkDto[];
      }
    >
  > {
    const [prescriptionItems, repLinks] = await Promise.all([
      this.prismaService.db.prescriptionItem.findMany({
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
      }),
      this.prismaService.db.medicalRepMedication.findMany({
        where: {
          medication_id: { in: medicationIds },
          medical_rep: { is_deleted: false },
        },
        select: {
          medication_id: true,
          medical_rep: {
            select: { id: true, full_name: true, company_name: true },
          },
        },
      }),
    ]);

    const prescribersByMed = new Map<
      string,
      Map<string, MedicationPrescriberDto>
    >();
    const totalByMed = new Map<string, number>();

    for (const item of prescriptionItems) {
      const medId = item.medication_id!;
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

    const repsByMed = new Map<string, MedicalRepLinkDto[]>();
    for (const link of repLinks) {
      if (!repsByMed.has(link.medication_id))
        repsByMed.set(link.medication_id, []);
      repsByMed.get(link.medication_id)!.push(link.medical_rep);
    }

    const result = new Map<
      string,
      {
        total_prescriptions: number;
        top_prescribers: MedicationPrescriberDto[];
        medical_reps: MedicalRepLinkDto[];
      }
    >();

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
        medical_reps: repsByMed.get(medId) ?? [],
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
    if (
      !med ||
      (med.organization_id !== null &&
        med.organization_id !== user.organizationId)
    ) {
      throw new BadRequestException(
        `Medication ${medicationId} is not available to this organization`,
      );
    }
  }
}
