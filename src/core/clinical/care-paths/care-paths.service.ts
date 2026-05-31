import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';

@Injectable()
export class CarePathsService {
  constructor(private readonly prismaService: PrismaService) {}

  async findAll(filters: {
    specialtyId?: string;
    specialtyCode?: string;
    organizationId?: string;
  }) {
    const orgScope = filters.organizationId
      ? [{ organization_id: filters.organizationId }, { organization_id: null }]
      : [{ organization_id: null }];

    const carePaths = await this.prismaService.db.carePath.findMany({
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
        specialty: { select: { code: true } },
      },
      orderBy: [{ is_system: 'desc' }, { order: 'asc' }],
    });

    return Promise.all(carePaths.map((cp) => this.attachHistorySections(cp)));
  }

  /**
   * Resolve the care path's relevant history-section codes from
   * `CarePathHistorySection` and fold them onto the row (dropping the joined
   * `specialty` selector used only to key the lookup).
   */
  private async attachHistorySections<
    T extends { code: string; specialty: { code: string } },
  >(
    carePath: T,
  ): Promise<Omit<T, 'specialty'> & { history_section_codes: string[] }> {
    const { specialty, ...rest } = carePath;
    const rows = await this.prismaService.db.carePathHistorySection.findMany({
      where: {
        specialty_code: specialty.code,
        care_path_code: carePath.code,
        is_deleted: false,
      },
      orderBy: { order: 'asc' },
      select: { section_code: true },
    });
    return {
      ...rest,
      history_section_codes: rows.map((r) => r.section_code),
    };
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
        specialty: { select: { code: true } },
      },
    });
    if (!carePath) {
      throw new NotFoundException(`Care path ${id} not found`);
    }
    return this.attachHistorySections(carePath);
  }

  async findEpisodes(carePathId: string, organizationId: string) {
    await this.findOne(carePathId, organizationId);
    return this.prismaService.db.carePathEpisode.findMany({
      where: { care_path_id: carePathId, is_deleted: false },
      orderBy: { order: 'asc' },
    });
  }
}
