import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class RolesService {
  constructor(private readonly prismaService: PrismaService) {}

  async listRoles() {
    return this.prismaService.db.role.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
