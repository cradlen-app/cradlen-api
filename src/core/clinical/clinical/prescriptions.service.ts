import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { buildRevision } from '@common/utils/revisions.helper';
import { MedicationsService } from '../medications/medications.service';
import { VisitAccessService } from './visit-access.service';
import {
  CreatePrescriptionItemDto,
  UpdatePrescriptionItemDto,
  UpsertPrescriptionDto,
} from './dto/prescription.dto';

@Injectable()
export class PrescriptionsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly visitAccess: VisitAccessService,
    private readonly medicationsService: MedicationsService,
  ) {}

  async findOne(visitId: string, user: AuthContext) {
    const visit = await this.visitAccess.loadOrThrow(visitId, user);
    await this.visitAccess.assertBranchAccess(visit, user);
    return this.prismaService.db.prescription.findUnique({
      where: { visit_id: visitId },
      include: {
        items: { where: { is_deleted: false }, orderBy: { order: 'asc' } },
      },
    });
  }

  async upsert(visitId: string, dto: UpsertPrescriptionDto, user: AuthContext) {
    const visit = await this.visitAccess.loadOrThrow(visitId, user);
    this.visitAccess.assertCanEditPrescription(visit, user);

    const prior = await this.prismaService.db.prescription.findUnique({
      where: { visit_id: visitId },
    });

    if (!prior) {
      return this.prismaService.db.prescription.create({
        data: {
          visit_id: visitId,
          prescribed_by_id: user.profileId,
          notes: dto.notes ?? null,
        },
        include: {
          items: { where: { is_deleted: false }, orderBy: { order: 'asc' } },
        },
      });
    }

    const nextNotes = dto.notes ?? null;
    const noteChanged = prior.notes !== nextNotes;

    return this.prismaService.db.$transaction(async (tx) => {
      if (noteChanged) {
        await tx.prescriptionRevision.create({
          data: buildRevision(prior, ['notes'], user.profileId),
        });
      }
      return tx.prescription.update({
        where: { id: prior.id },
        data: {
          notes: nextNotes,
          updated_by_id: user.profileId,
          ...(noteChanged ? { version: { increment: 1 } } : {}),
        },
        include: {
          items: { where: { is_deleted: false }, orderBy: { order: 'asc' } },
        },
      });
    });
  }

  async addItem(
    visitId: string,
    dto: CreatePrescriptionItemDto,
    user: AuthContext,
  ) {
    const visit = await this.visitAccess.loadOrThrow(visitId, user);
    this.visitAccess.assertCanEditPrescription(visit, user);
    this.assertItemShape(dto);
    if (dto.medication_id) {
      await this.medicationsService.assertReferenceable(
        dto.medication_id,
        user,
      );
    }

    const prescription = await this.prismaService.db.prescription.upsert({
      where: { visit_id: visitId },
      create: {
        visit_id: visitId,
        prescribed_by_id: user.profileId,
      },
      update: {},
    });

    const order = dto.order ?? (await this.nextOrder(prescription.id));
    return this.prismaService.db.prescriptionItem.create({
      data: {
        prescription_id: prescription.id,
        medication_id: dto.medication_id ?? null,
        custom_drug_name: dto.custom_drug_name ?? null,
        dose: dto.dose,
        route: dto.route ?? null,
        frequency: dto.frequency,
        duration_days: dto.duration_days ?? null,
        instructions: dto.instructions ?? null,
        order,
      },
    });
  }

  async updateItem(
    itemId: string,
    dto: UpdatePrescriptionItemDto,
    user: AuthContext,
  ) {
    const item = await this.loadItemOrThrow(itemId, user);
    this.visitAccess.assertCanEditPrescription(item.prescription.visit, user);

    const next = {
      medication_id:
        dto.medication_id !== undefined
          ? dto.medication_id
          : item.medication_id,
      custom_drug_name:
        dto.custom_drug_name !== undefined
          ? dto.custom_drug_name
          : item.custom_drug_name,
    };
    this.assertItemShape({
      medication_id: next.medication_id ?? undefined,
      custom_drug_name: next.custom_drug_name ?? undefined,
    });
    if (
      dto.medication_id !== undefined &&
      dto.medication_id &&
      dto.medication_id !== item.medication_id
    ) {
      await this.medicationsService.assertReferenceable(
        dto.medication_id,
        user,
      );
    }

    const updates: Record<string, unknown> = {
      ...(dto.medication_id !== undefined && {
        medication_id: dto.medication_id,
      }),
      ...(dto.custom_drug_name !== undefined && {
        custom_drug_name: dto.custom_drug_name,
      }),
      ...(dto.dose !== undefined && { dose: dto.dose }),
      ...(dto.route !== undefined && { route: dto.route }),
      ...(dto.frequency !== undefined && { frequency: dto.frequency }),
      ...(dto.duration_days !== undefined && {
        duration_days: dto.duration_days,
      }),
      ...(dto.instructions !== undefined && {
        instructions: dto.instructions,
      }),
      ...(dto.order !== undefined && { order: dto.order }),
    };
    const changed = Object.keys(updates);
    if (changed.length === 0) return item;

    return this.prismaService.db.$transaction(async (tx) => {
      await tx.prescriptionItemRevision.create({
        data: buildRevision(item, changed, user.profileId),
      });
      return tx.prescriptionItem.update({
        where: { id: itemId },
        data: {
          ...updates,
          updated_by_id: user.profileId,
          version: { increment: 1 },
        },
      });
    });
  }

  async removeItem(itemId: string, user: AuthContext) {
    const item = await this.loadItemOrThrow(itemId, user);
    this.visitAccess.assertCanEditPrescription(item.prescription.visit, user);
    await this.prismaService.db.$transaction(async (tx) => {
      await tx.prescriptionItemRevision.create({
        data: buildRevision(item, ['is_deleted'], user.profileId),
      });
      await tx.prescriptionItem.update({
        where: { id: itemId },
        data: {
          is_deleted: true,
          deleted_at: new Date(),
          updated_by_id: user.profileId,
          version: { increment: 1 },
        },
      });
    });
  }

  private async loadItemOrThrow(itemId: string, user: AuthContext) {
    const item = await this.prismaService.db.prescriptionItem.findUnique({
      where: { id: itemId },
      include: {
        prescription: {
          include: {
            visit: {
              include: {
                episode: {
                  select: {
                    journey: { select: { organization_id: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (
      !item ||
      item.prescription.visit.episode?.journey?.organization_id !==
        user.organizationId
    ) {
      throw new NotFoundException(`Prescription item ${itemId} not found`);
    }
    return item;
  }

  private async nextOrder(prescriptionId: string): Promise<number> {
    const last = await this.prismaService.db.prescriptionItem.findFirst({
      where: { prescription_id: prescriptionId, is_deleted: false },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return (last?.order ?? -1) + 1;
  }

  private assertItemShape(item: {
    medication_id?: string;
    custom_drug_name?: string;
  }) {
    const hasCatalog = !!item.medication_id;
    const hasCustom =
      !!item.custom_drug_name && item.custom_drug_name.trim().length > 0;
    if (hasCatalog === hasCustom) {
      throw new BadRequestException(
        'Each prescription item must have exactly one of medication_id or custom_drug_name',
      );
    }
  }
}
