import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { paginated } from '@common/utils/pagination.utils';
import { ListGuardiansQueryDto } from './dto/list-guardians-query.dto';

@Injectable()
export class GuardiansService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Searches guardians that are linked (via PatientGuardian) to at least one
   * patient with a PatientJourney in the caller's organization. Used by the
   * book-visit spouse autocomplete — frontend picks an existing spouse, the
   * resolved id flows back into `book-visit.dto.spouse_guardian_id`.
   */
  async search(query: ListGuardiansQueryDto, user: AuthContext) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.GuardianWhereInput = {
      is_deleted: false,
      patient_links: {
        some: {
          patient: {
            journeys: { some: { organization_id: user.organizationId } },
          },
        },
      },
      ...(query.search && {
        OR: [
          { full_name: { contains: query.search, mode: 'insensitive' } },
          { national_id: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await this.prismaService.db.$transaction([
      this.prismaService.db.guardian.findMany({
        where,
        orderBy: { full_name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          full_name: true,
          national_id: true,
          phone_number: true,
        },
      }),
      this.prismaService.db.guardian.count({ where }),
    ]);

    return paginated(items, { page, limit, total });
  }
}
