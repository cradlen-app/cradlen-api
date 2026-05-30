import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

@Injectable()
export class SpecialtiesService {
  constructor(private readonly prismaService: PrismaService) {}

  findLookup() {
    return this.prismaService.db.specialty.findMany({
      where: { is_deleted: false },
      select: { code: true, name: true },
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
      },
    });
  }
}
