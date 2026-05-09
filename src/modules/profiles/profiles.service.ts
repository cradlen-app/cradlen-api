import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EngagementType, ExecutiveTitle } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';

@Injectable()
export class ProfilesService {
  constructor(private readonly prismaService: PrismaService) {}

  getEnumLookups() {
    return {
      executive_titles: Object.values(ExecutiveTitle).map((code) => ({
        code,
        name: humanizeEnumValue(code),
      })),
      engagement_types: Object.values(EngagementType).map((code) => ({
        code,
        name: humanizeEnumValue(code),
      })),
    };
  }

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
    const existing = await this.prismaService.db.profile.findFirst({
      where: { id: profileId, user_id: userId, is_deleted: false },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Profile not found');

    const {
      first_name,
      last_name,
      phone_number,
      executive_title,
      engagement_type,
      job_function_codes,
      specialty_codes,
    } = dto;

    const hasUserFields =
      first_name !== undefined ||
      last_name !== undefined ||
      phone_number !== undefined;

    const hasProfileScalarFields =
      executive_title !== undefined || engagement_type !== undefined;

    const jobFunctionIds =
      job_function_codes !== undefined
        ? await this.resolveJobFunctionIds(job_function_codes)
        : undefined;

    const specialtyIds =
      specialty_codes !== undefined
        ? await this.resolveSpecialtyIds(specialty_codes)
        : undefined;

    await this.prismaService.db.$transaction(async (tx) => {
      if (hasUserFields) {
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(first_name !== undefined && { first_name }),
            ...(last_name !== undefined && { last_name }),
            ...(phone_number !== undefined && { phone_number }),
          },
        });
      }

      if (hasProfileScalarFields) {
        await tx.profile.update({
          where: { id: profileId },
          data: {
            ...(executive_title !== undefined && { executive_title }),
            ...(engagement_type !== undefined && { engagement_type }),
          },
        });
      }

      if (jobFunctionIds !== undefined) {
        await tx.profileJobFunction.deleteMany({
          where: { profile_id: profileId },
        });
        if (jobFunctionIds.length) {
          await tx.profileJobFunction.createMany({
            data: jobFunctionIds.map((job_function_id) => ({
              profile_id: profileId,
              job_function_id,
            })),
          });
        }
      }

      if (specialtyIds !== undefined) {
        await tx.profileSpecialty.deleteMany({
          where: { profile_id: profileId },
        });
        if (specialtyIds.length) {
          await tx.profileSpecialty.createMany({
            data: specialtyIds.map((specialty_id) => ({
              profile_id: profileId,
              specialty_id,
            })),
          });
        }
      }
    });

    const profile = await this.prismaService.db.profile.findUniqueOrThrow({
      where: { id: profileId },
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

    return {
      id: profile.id,
      first_name: profile.user.first_name,
      last_name: profile.user.last_name,
      email: profile.user.email,
      phone_number: profile.user.phone_number,
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

  private async resolveJobFunctionIds(codes: string[]): Promise<string[]> {
    const deduped = [...new Set(codes)];
    if (!deduped.length) return [];

    const rows = await this.prismaService.db.jobFunction.findMany({
      where: { code: { in: deduped } },
    });
    if (rows.length !== deduped.length) {
      const found = new Set(rows.map((jf) => jf.code));
      const missing = deduped.filter((c) => !found.has(c));
      throw new BadRequestException(
        `Unknown job_function_codes: ${missing.join(', ')}`,
      );
    }
    return rows.map((jf) => jf.id);
  }

  private async resolveSpecialtyIds(values: string[]): Promise<string[]> {
    const deduped = [...new Set(values)];
    if (!deduped.length) return [];

    const rows = await this.prismaService.db.specialty.findMany({
      where: {
        OR: [
          { code: { in: deduped } },
          { name: { in: deduped, mode: 'insensitive' } },
        ],
        is_deleted: false,
      },
    });
    const matchedCodes = new Set(rows.map((s) => s.code));
    const matchedNames = new Set(rows.map((s) => s.name.toLowerCase()));
    const missing = deduped.filter(
      (v) => !matchedCodes.has(v) && !matchedNames.has(v.toLowerCase()),
    );
    if (missing.length) {
      throw new BadRequestException(
        `Unknown specialty_codes: ${missing.join(', ')}`,
      );
    }
    return rows.map((s) => s.id);
  }
}

function humanizeEnumValue(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
