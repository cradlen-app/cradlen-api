import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthContext } from '../../common/interfaces/auth-context.interface';
import { CreateMedicalRepDto } from './dto/create-medical-rep.dto';
import { UpdateMedicalRepDto } from './dto/update-medical-rep.dto';
import { ListMedicalRepsQueryDto } from './dto/list-medical-reps-query.dto';
import { paginated } from '../../common/utils/pagination.utils';

@Injectable()
export class MedicalRepsService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(dto: CreateMedicalRepDto, user: AuthContext) {
    return this.prismaService.db.medicalRep.create({
      data: {
        organization_id: user.organizationId,
        full_name: dto.full_name,
        company: dto.company,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        territory: dto.territory ?? null,
        notes: dto.notes ?? null,
      },
    });
  }

  async findAll(query: ListMedicalRepsQueryDto, user: AuthContext) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.MedicalRepWhereInput = {
      organization_id: user.organizationId,
      is_deleted: false,
      ...(query.company && {
        company: { contains: query.company, mode: 'insensitive' },
      }),
      ...(query.search && {
        OR: [
          {
            full_name: { contains: query.search, mode: 'insensitive' as const },
          },
          { company: { contains: query.search, mode: 'insensitive' as const } },
          { phone: { contains: query.search } },
          { email: { contains: query.search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [reps, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.medicalRep.findMany({
        where,
        orderBy: [{ company: 'asc' }, { full_name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaService.db.medicalRep.count({ where }),
    ]);
    return paginated(reps, { page, limit, total });
  }

  async findOne(id: string, user: AuthContext) {
    const rep = await this.prismaService.db.medicalRep.findFirst({
      where: {
        id,
        organization_id: user.organizationId,
        is_deleted: false,
      },
    });
    if (!rep) throw new NotFoundException(`Medical rep ${id} not found`);
    return rep;
  }

  async update(id: string, dto: UpdateMedicalRepDto, user: AuthContext) {
    await this.findOne(id, user);
    return this.prismaService.db.medicalRep.update({
      where: { id },
      data: {
        ...(dto.full_name !== undefined && { full_name: dto.full_name }),
        ...(dto.company !== undefined && { company: dto.company }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.territory !== undefined && { territory: dto.territory }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  async remove(id: string, user: AuthContext) {
    await this.findOne(id, user);
    await this.prismaService.db.medicalRep.update({
      where: { id },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }
}
