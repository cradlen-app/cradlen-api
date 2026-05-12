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
import { CreateLabTestDto } from './dto/create-lab-test.dto';
import { UpdateLabTestDto } from './dto/update-lab-test.dto';
import { ListLabTestsQueryDto } from './dto/list-lab-tests-query.dto';

@Injectable()
export class LabTestsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async findAll(query: ListLabTestsQueryDto, user: AuthContext) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where: Prisma.LabTestWhereInput = {
      is_deleted: false,
      AND: [
        {
          OR: [
            { organization_id: null },
            { organization_id: user.organizationId },
          ],
        },
        ...(query.category ? [{ category: query.category }] : []),
        ...(query.specialty_id ? [{ specialty_id: query.specialty_id }] : []),
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
      this.prismaService.db.labTest.findMany({
        where,
        orderBy: [{ organization_id: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaService.db.labTest.count({ where }),
    ]);
    return paginated(items, { page, limit, total });
  }

  async create(dto: CreateLabTestDto, user: AuthContext) {
    const existing = await this.prismaService.db.labTest.findFirst({
      where: { organization_id: user.organizationId, code: dto.code },
    });
    if (existing) {
      throw new ConflictException(
        `Lab test with code "${dto.code}" already exists in this organization`,
      );
    }
    return this.prismaService.db.labTest.create({
      data: {
        organization_id: user.organizationId,
        code: dto.code,
        name: dto.name,
        category: dto.category,
        specialty_id: dto.specialty_id ?? null,
        added_by_id: user.profileId,
      },
    });
  }

  async update(id: string, dto: UpdateLabTestDto, user: AuthContext) {
    const test = await this.prismaService.db.labTest.findUnique({
      where: { id, is_deleted: false },
    });
    if (!test) throw new NotFoundException(`Lab test ${id} not found`);
    if (test.organization_id === null) {
      throw new BadRequestException('Global lab tests cannot be modified');
    }
    if (test.organization_id !== user.organizationId) {
      throw new NotFoundException(`Lab test ${id} not found`);
    }
    const isOwner = await this.authorizationService.isOwner(
      user.profileId,
      user.organizationId,
    );
    if (!isOwner && test.added_by_id !== user.profileId) {
      throw new ForbiddenException(
        'Only the OWNER or the original creator can edit this lab test',
      );
    }
    return this.prismaService.db.labTest.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.specialty_id !== undefined && {
          specialty_id: dto.specialty_id,
        }),
      },
    });
  }

  async remove(id: string, user: AuthContext) {
    const test = await this.prismaService.db.labTest.findUnique({
      where: { id, is_deleted: false },
    });
    if (!test) throw new NotFoundException(`Lab test ${id} not found`);
    if (test.organization_id === null) {
      throw new BadRequestException('Global lab tests cannot be deleted');
    }
    if (test.organization_id !== user.organizationId) {
      throw new NotFoundException(`Lab test ${id} not found`);
    }
    await this.authorizationService.assertOwnerOnly(
      user.profileId,
      user.organizationId,
    );
    await this.prismaService.db.labTest.update({
      where: { id },
      data: { is_deleted: true, deleted_at: new Date() },
    });
  }

  async assertReferenceable(labTestId: string, user: AuthContext) {
    const test = await this.prismaService.db.labTest.findUnique({
      where: { id: labTestId, is_deleted: false },
      select: { organization_id: true },
    });
    if (
      !test ||
      (test.organization_id !== null &&
        test.organization_id !== user.organizationId)
    ) {
      throw new BadRequestException(
        `Lab test ${labTestId} is not available to this organization`,
      );
    }
  }
}
