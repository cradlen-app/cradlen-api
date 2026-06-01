import { Injectable } from '@nestjs/common';
import { LabTestCategory, Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { orgScopedReadFilter } from '../shared/org-scoped-catalog.js';

const RESULT_LIMIT = 25;

@Injectable()
export class LabTestsService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Type-ahead search over the lab-test catalog by name OR code, scoped to
   * global rows (organization_id = null) plus the caller's own org. Optional
   * category filter. Capped for the picker dropdown.
   */
  async search(
    filters: { search?: string; category?: LabTestCategory },
    organizationId: string,
  ) {
    const term = filters.search?.trim();
    const where: Prisma.LabTestWhereInput = {
      is_deleted: false,
      AND: [
        orgScopedReadFilter(organizationId),
        ...(filters.category ? [{ category: filters.category }] : []),
        ...(term
          ? [
              {
                OR: [
                  { name: { contains: term, mode: 'insensitive' as const } },
                  { code: { contains: term, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
    };

    return this.prismaService.db.labTest.findMany({
      where,
      orderBy: [
        { organization_id: { sort: 'asc', nulls: 'first' } },
        { name: 'asc' },
      ],
      take: RESULT_LIMIT,
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        specialty_id: true,
      },
    });
  }
}
