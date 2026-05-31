import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';

const RESULT_LIMIT = 25;

@Injectable()
export class DiagnosisCodesService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Type-ahead search over the ICD-10 catalog by code OR description (and
   * keyword synonyms). Billable codes first, then by code. Capped for the
   * picker dropdown.
   */
  async search(filters: { search?: string; specialtyCode?: string }) {
    const term = filters.search?.trim();
    const where: Prisma.DiagnosisCodeWhereInput = {
      is_deleted: false,
      ...(filters.specialtyCode
        ? { specialty_code: filters.specialtyCode }
        : {}),
      ...(term
        ? {
            OR: [
              { code: { contains: term, mode: 'insensitive' } },
              { description: { contains: term, mode: 'insensitive' } },
              { keywords: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return this.prismaService.db.diagnosisCode.findMany({
      where,
      orderBy: [{ billable: 'desc' }, { code: 'asc' }],
      take: RESULT_LIMIT,
      select: {
        id: true,
        code: true,
        description: true,
        chapter: true,
        specialty_code: true,
        billable: true,
      },
    });
  }
}
