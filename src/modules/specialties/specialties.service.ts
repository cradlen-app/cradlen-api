import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

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

  findAll() {
    return this.prismaService.db.specialty.findMany({
      where: { is_deleted: false },
      include: {
        templates: {
          where: { is_deleted: false },
          include: {
            episodes: {
              where: { is_deleted: false },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });
  }

  async findJourneyTemplates(id: string) {
    const specialty = await this.prismaService.db.specialty.findFirst({
      where: { id, is_deleted: false },
    });
    if (!specialty) throw new NotFoundException(`Specialty ${id} not found`);
    return this.prismaService.db.journeyTemplate.findMany({
      where: { specialty_id: id, is_deleted: false },
      include: { episodes: { orderBy: { order: 'asc' } } },
    });
  }
}
