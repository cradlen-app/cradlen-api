import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { paginated } from '@common/utils/pagination.utils.js';
import { ListGuardiansQueryDto } from './dto/list-guardians-query.dto.js';

@Injectable()
export class GuardiansService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Guardian lookup for the booking/registration autocomplete. Mirrors the
   * global patient lookup: a `Guardian` is a global master record (like
   * `Patient`), so WITH a search term this resolves guardians by name /
   * national id across ALL organizations and returns full identity to prefill —
   * the caller's own-org guardians (linked to a patient with a journey here)
   * rank first. WITHOUT a search term it returns only the caller's own-org
   * guardians (the roster), so it can't dump the whole table.
   * (Cross-org exposure is an accepted product decision — see
   * SECURITY-ASSESSMENT.md F7.)
   */
  async search(query: ListGuardiansQueryDto, user: AuthContext) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const select = {
      id: true,
      full_name: true,
      national_id: true,
      phone_number: true,
    };
    const ownWhere: Prisma.GuardianWhereInput = {
      is_deleted: false,
      patient_links: {
        some: {
          patient: {
            journeys: { some: { organization_id: user.organizationId } },
          },
        },
      },
    };

    // No search term → org roster only (existing behavior), paginated.
    if (!search) {
      const [items, total] = await this.prismaService.db.$transaction([
        this.prismaService.db.guardian.findMany({
          where: ownWhere,
          orderBy: { full_name: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
          select,
        }),
        this.prismaService.db.guardian.count({ where: ownWhere }),
      ]);
      return paginated(items, { page, limit, total });
    }

    // With a search term → GLOBAL lookup: caller's own guardians first, then
    // matches from any org, deduped and capped.
    const fuzzy: Prisma.GuardianWhereInput = {
      OR: [
        { full_name: { contains: search, mode: 'insensitive' } },
        { national_id: { contains: search, mode: 'insensitive' } },
      ],
    };
    const [own, all] = await this.prismaService.db.$transaction([
      this.prismaService.db.guardian.findMany({
        where: { AND: [ownWhere, fuzzy] },
        orderBy: { full_name: 'asc' },
        take: limit,
        select,
      }),
      this.prismaService.db.guardian.findMany({
        where: { is_deleted: false, ...fuzzy },
        orderBy: { full_name: 'asc' },
        take: limit,
        select,
      }),
    ]);
    const ownIds = new Set(own.map((g) => g.id));
    const items = [...own, ...all.filter((g) => !ownIds.has(g.id))].slice(
      0,
      limit,
    );
    return paginated(items, { page: 1, limit, total: items.length });
  }
}
