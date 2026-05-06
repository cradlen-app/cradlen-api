import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class JourneyTemplatesService {
  constructor(private readonly prismaService: PrismaService) {}

  findAll(specialtyId: string | undefined) {
    return this.prismaService.db.journeyTemplate.findMany({
      where: specialtyId
        ? { specialty_id: specialtyId, is_deleted: false }
        : { is_deleted: false },
      include: {
        episodes: { where: { is_deleted: false }, orderBy: { order: 'asc' } },
      },
    });
  }

  async findOne(id: string) {
    const template = await this.prismaService.db.journeyTemplate.findUnique({
      where: { id },
      include: {
        episodes: { where: { is_deleted: false }, orderBy: { order: 'asc' } },
      },
    });
    if (!template || template.is_deleted) {
      throw new NotFoundException(`Journey template ${id} not found`);
    }
    return template;
  }
}
