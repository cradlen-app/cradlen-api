import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

@Injectable()
export class ProceduresService {
  constructor(private readonly prismaService: PrismaService) {}

  async lookup(params: { specialtyId?: string; search?: string }) {
    const search = params.search?.trim();
    return this.prismaService.db.procedure.findMany({
      where: {
        is_deleted: false,
        ...(params.specialtyId ? { specialty_id: params.specialtyId } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        specialty: { select: { id: true, code: true, name: true } },
      },
      orderBy: { name: 'asc' },
      take: 100,
    });
  }
}
