import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class JourneyTemplatesService {
  constructor(private readonly prismaService: PrismaService) {}

  findAll(specialtyId: string | undefined) {
    return this.prismaService.db.journeyTemplate.findMany({
      where: specialtyId ? { specialty_id: specialtyId } : {},
      include: { episodes: { orderBy: { order: 'asc' } } },
    });
  }

  async findOne(id: string) {
    const template = await this.prismaService.db.journeyTemplate.findUnique({
      where: { id },
      include: { episodes: { orderBy: { order: 'asc' } } },
    });
    if (!template)
      throw new NotFoundException(`Journey template ${id} not found`);
    return template;
  }
}
