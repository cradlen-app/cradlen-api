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
        organization: { is_deleted: false, status: 'ACTIVE' },
      },
      include: {
        organization: {
          include: {
            specialty_links: { include: { specialty: true } },
          },
        },
        roles: { include: { role: true } },
        branches: {
          where: { branch: { is_deleted: false } },
          include: { branch: true },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    return profiles.map((profile) => ({
      id: profile.id,
      organization: {
        id: profile.organization.id,
        name: profile.organization.name,
        specialties: profile.organization.specialty_links.map((l) => ({
          id: l.specialty.id,
          code: l.specialty.code,
          name: l.specialty.name,
        })),
        status: profile.organization.status,
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
        organization: true,
        roles: { include: { role: true } },
        branches: {
          where: { branch: { is_deleted: false } },
          include: { branch: true },
        },
        job_functions: { include: { job_function: true } },
        specialty_links: { include: { specialty: true } },
      },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    const { first_name, last_name, phone_number } = dto;
    const hasUserFields =
      first_name !== undefined ||
      last_name !== undefined ||
      phone_number !== undefined;

    const updatedUser = hasUserFields
      ? await this.prismaService.db.user.update({
          where: { id: userId },
          data: {
            ...(first_name !== undefined && { first_name }),
            ...(last_name !== undefined && { last_name }),
            ...(phone_number !== undefined && { phone_number }),
          },
        })
      : profile.user;

    return {
      id: profile.id,
      first_name: updatedUser.first_name,
      last_name: updatedUser.last_name,
      email: updatedUser.email,
      phone_number: updatedUser.phone_number,
      executive_title: profile.executive_title,
      engagement_type: profile.engagement_type,
      roles: profile.roles.map((item) => item.role.name),
      organization: {
        id: profile.organization.id,
        name: profile.organization.name,
      },
      branches: profile.branches.map((item) => ({
        id: item.branch.id,
        name: item.branch.name,
        city: item.branch.city,
        governorate: item.branch.governorate,
        is_main: item.branch.is_main,
      })),
      job_functions: profile.job_functions.map((jf) => ({
        id: jf.job_function.id,
        code: jf.job_function.code,
        name: jf.job_function.name,
        is_clinical: jf.job_function.is_clinical,
      })),
      specialties: profile.specialty_links.map((sl) => ({
        id: sl.specialty.id,
        code: sl.specialty.code,
        name: sl.specialty.name,
      })),
    };
  }
}
