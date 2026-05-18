import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service';

export interface ChiefComplaintCategoryDto {
  code: string;
  label: string;
}

@Injectable()
export class ChiefComplaintsService {
  constructor(private readonly prismaService: PrismaService) {}

  async findBySpecialty(
    specialtyCode: string,
    carePathCode?: string,
  ): Promise<ChiefComplaintCategoryDto[]> {
    const rows = await this.prismaService.db.chiefComplaintCategory.findMany({
      where: {
        specialty_code: specialtyCode,
        care_path_code: carePathCode ?? null,
        is_deleted: false,
      },
      select: { code: true, label: true },
      orderBy: { order: 'asc' },
    });

    if (rows.length === 0 && carePathCode) {
      // Fall back to general categories for the specialty (care_path_code = null)
      return this.prismaService.db.chiefComplaintCategory.findMany({
        where: {
          specialty_code: specialtyCode,
          care_path_code: null,
          is_deleted: false,
        },
        select: { code: true, label: true },
        orderBy: { order: 'asc' },
      });
    }

    return rows;
  }
}
