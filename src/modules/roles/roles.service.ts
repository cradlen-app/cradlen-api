import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StaffService } from '../staff/staff.service.js';

@Injectable()
export class RolesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly staffService: StaffService,
  ) {}

  async listRoles(
    currentUserId: string,
    organizationId: string,
    branchId?: string,
  ) {
    await this.staffService.assertOwner(
      currentUserId,
      organizationId,
      branchId,
    );

    return this.prismaService.db.role.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
