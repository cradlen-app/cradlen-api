import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

@Injectable()
export class RolesService {
  constructor(private readonly prismaService: PrismaService) {}

  findLookup() {
    return this.prismaService.db.role.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
