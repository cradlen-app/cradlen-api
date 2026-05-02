import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';

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
        branches: {
          where: { is_deleted: false, branch: { is_deleted: false } },
          include: { branch: true },
        },
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

  async updateProfile(
    userId: string,
    profileId: string,
    dto: UpdateProfileDto,
  ) {
    const profile = await this.prismaService.db.profile.findFirst({
      where: { id: profileId, user_id: userId, is_deleted: false },
      include: {
        user: true,
        account: true,
        roles: { include: { role: true } },
        branches: {
          where: { is_deleted: false, branch: { is_deleted: false } },
          include: { branch: true },
        },
      },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    const { first_name, last_name, phone_number, ...profileFields } = dto;
    const userFields = { first_name, last_name, phone_number };
    const hasUserFields = Object.values(userFields).some(
      (v) => v !== undefined,
    );
    const hasProfileFields = Object.values(profileFields).some(
      (v) => v !== undefined,
    );

    const [updatedUser, updatedProfile] =
      await this.prismaService.db.$transaction(async (tx) => {
        const u = hasUserFields
          ? await tx.user.update({
              where: { id: userId },
              data: {
                ...(first_name !== undefined && { first_name }),
                ...(last_name !== undefined && { last_name }),
                ...(phone_number !== undefined && { phone_number }),
              },
            })
          : profile.user;

        const p = hasProfileFields
          ? await tx.profile.update({
              where: { id: profileId },
              data: {
                ...(profileFields.job_title !== undefined && {
                  job_title: profileFields.job_title,
                }),
                ...(profileFields.specialty !== undefined && {
                  specialty: profileFields.specialty,
                }),
                ...(profileFields.is_clinical !== undefined && {
                  is_clinical: profileFields.is_clinical,
                }),
              },
            })
          : profile;

        return [u, p];
      });

    return {
      id: profile.id,
      first_name: updatedUser.first_name,
      last_name: updatedUser.last_name,
      email: updatedUser.email,
      phone_number: updatedUser.phone_number,
      job_title: updatedProfile.job_title,
      specialty: updatedProfile.specialty,
      is_clinical: updatedProfile.is_clinical,
      roles: profile.roles.map((item) => item.role.name),
      account: { id: profile.account.id, name: profile.account.name },
      branches: profile.branches.map((item) => ({
        id: item.branch.id,
        name: item.branch.name,
        city: item.branch.city,
        governorate: item.branch.governorate,
        is_main: item.branch.is_main,
      })),
    };
  }
}
