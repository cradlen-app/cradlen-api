import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma, Specialty } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

@Injectable()
export class SpecialtyCatalogService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Resolve a list of specialty codes (or, case-insensitively, names) to their
   * Specialty rows. Lifted from the duplicated `OR:[{code},{name}]` query in
   * organizations/signup.
   *
   * @param validate when true, throws BadRequestException if any entry is
   *   unmatched (matches the resolveJobFunctions/invitations convention). When
   *   false, unmatched entries are silently skipped (legacy signup behavior).
   * @param client optional transaction client so callers can resolve inside
   *   their own `$transaction` (avoids a read/write TOCTOU on the specialty set).
   */
  async resolveByCodeOrName(
    codeOrName: string[],
    { validate = false }: { validate?: boolean } = {},
    client: Prisma.TransactionClient = this.prismaService.db,
  ): Promise<Specialty[]> {
    if (codeOrName.length === 0) return [];
    const rows = await client.specialty.findMany({
      where: {
        OR: [
          { code: { in: codeOrName } },
          { name: { in: codeOrName, mode: 'insensitive' } },
        ],
        is_deleted: false,
      },
    });

    if (validate) {
      const matched = new Set<string>();
      for (const row of rows) {
        matched.add(row.code.toLowerCase());
        matched.add(row.name.toLowerCase());
      }
      const missing = codeOrName.filter((c) => !matched.has(c.toLowerCase()));
      if (missing.length) {
        throw new BadRequestException(
          `Unknown specialties: ${missing.join(', ')}`,
        );
      }
    }

    return rows;
  }

  findLookup() {
    return this.prismaService.db.specialty.findMany({
      where: { is_deleted: false },
      select: {
        code: true,
        name: true,
        subspecialties: {
          where: { is_deleted: false },
          select: { code: true, name: true },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Subspecialties for dropdowns, optionally filtered to a parent specialty.
   */
  subspecialtyLookup(parentCode?: string) {
    return this.prismaService.db.subspecialty.findMany({
      where: {
        is_deleted: false,
        ...(parentCode
          ? { specialty: { code: parentCode, is_deleted: false } }
          : {}),
      },
      select: { code: true, name: true, specialty: { select: { code: true } } },
      orderBy: { name: 'asc' },
    });
  }

  findAll(organizationId: string) {
    return this.prismaService.db.specialty.findMany({
      where: {
        is_deleted: false,
        org_links: { some: { organization_id: organizationId } },
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        templates: {
          where: { is_deleted: false },
          select: {
            id: true,
            name: true,
            type: true,
            description: true,
            episodes: {
              where: { is_deleted: false },
              orderBy: { order: 'asc' },
              select: { id: true, name: true, order: true },
            },
          },
        },
        subspecialties: {
          where: { is_deleted: false },
          select: { id: true, code: true, name: true },
          orderBy: { name: 'asc' },
        },
      },
    });
  }
}
