import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthorizationService } from '../../common/authorization/authorization.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { paginated } from '../../common/utils/pagination.utils';
import { CreateMedicationDto } from './dto/create-medication.dto';
import { UpdateMedicationDto } from './dto/update-medication.dto';
import { ListMedicationsQueryDto } from './dto/list-medications-query.dto';

@Injectable()
export class MedicationsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async findAll(query: ListMedicationsQueryDto, user: AuthContext) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where: Prisma.MedicationWhereInput = {
      is_deleted: false,
      OR: [{ organization_id: null }, { organization_id: user.organizationId }],
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { generic_name: { contains: query.search, mode: 'insensitive' } },
          { code: { contains: query.search, mode: 'insensitive' } },
        ],
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
    return paginated(items, { page, limit, total });
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
        ...(dto.generic_name !== undefined && {
          generic_name: dto.generic_name,
        }),
        ...(dto.form !== undefined && { form: dto.form }),
        ...(dto.strength !== undefined && { strength: dto.strength }),
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
