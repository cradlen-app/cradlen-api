import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';

@Injectable()
export class CarePathsService {
  constructor(private readonly prismaService: PrismaService) {}

  findAll(filters: {
    specialtyId?: string;
    specialtyCode?: string;
    organizationId?: string;
  }) {
    const orgScope = filters.organizationId
      ? [{ organization_id: filters.organizationId }, { organization_id: null }]
      : [{ organization_id: null }];

    return this.prismaService.db.carePath.findMany({
      where: {
        is_deleted: false,
        ...(filters.specialtyId ? { specialty_id: filters.specialtyId } : {}),
        ...(filters.specialtyCode
          ? { specialty: { code: filters.specialtyCode } }
          : {}),
        OR: orgScope,
      },
      include: {
        episodes: {
          where: { is_deleted: false },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: [{ is_system: 'desc' }, { order: 'asc' }],
    });
  }

  async findOne(id: string, organizationId: string) {
    const carePath = await this.prismaService.db.carePath.findFirst({
      where: {
        id,
        is_deleted: false,
        // System paths (null org) plus the caller's own org-specific paths;
        // never another org's private path.
        OR: [{ organization_id: null }, { organization_id: organizationId }],
      },
      include: {
        episodes: {
          where: { is_deleted: false },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!carePath) {
      throw new NotFoundException(`Care path ${id} not found`);
    }
    return carePath;
  }

  async findEpisodes(carePathId: string, organizationId: string) {
    await this.findOne(carePathId, organizationId);
    return this.prismaService.db.carePathEpisode.findMany({
      where: { care_path_id: carePathId, is_deleted: false },
      orderBy: { order: 'asc' },
    });
  }
}
