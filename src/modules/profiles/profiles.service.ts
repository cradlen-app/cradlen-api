import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class ProfilesService {
  constructor(private readonly prismaService: PrismaService) {}

  async listProfiles(userId: string) {
    const profiles = await this.prismaService.db.profile.findMany({
      where: {
        user_id: userId,
        is_deleted: false,
        is_active: true,
        account: { is_deleted: false, status: 'ACTIVE' },
      },
      include: {
        account: true,
        roles: { include: { role: true } },
        branches: { include: { branch: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    return profiles.map((profile) => ({
      id: profile.id,
      account: {
        id: profile.account.id,
        name: profile.account.name,
        specialities: profile.account.specialities,
        status: profile.account.status,
      },
      roles: profile.roles.map((item) => item.role.name),
      branches: profile.branches.map((item) => ({
        id: item.branch.id,
        name: item.branch.name,
        city: item.branch.city,
        governorate: item.branch.governorate,
        is_main: item.branch.is_main,
      })),
    }));
  }
}
