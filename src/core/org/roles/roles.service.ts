import { Injectable } from '@nestjs/common';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { PrismaService } from '@infrastructure/database/prisma.service.js';

@Injectable()
export class RolesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async listRoles(profileId: string, organizationId: string) {
    await this.authorizationService.assertCanManageStaff(
      profileId,
      organizationId,
    );
    return this.prismaService.db.role.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
