import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class SpecialtiesService {
  constructor(private readonly prismaService: PrismaService) {}

  findAll() {
    return this.prismaService.db.specialty.findMany({
      include: {
        templates: {
          include: { episodes: { orderBy: { order: 'asc' } } },
        },
      },
    });
  }

  async findJourneyTemplates(id: string) {
    const specialty = await this.prismaService.db.specialty.findUnique({
      where: { id },
    });
    if (!specialty) throw new NotFoundException(`Specialty ${id} not found`);
    return this.prismaService.db.journeyTemplate.findMany({
      where: { specialty_id: id },
      include: { episodes: { orderBy: { order: 'asc' } } },
    });
  }
}
