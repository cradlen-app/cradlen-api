import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EngagementType, ExecutiveTitle } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import {
  PROFILE_DETAIL_INCLUDE,
  PROFILE_SUMMARY_INCLUDE,
} from './profiles.includes.js';
import { toProfileDetail, toProfileSummary } from './profiles.mapper.js';

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
      include: PROFILE_SUMMARY_INCLUDE,
      orderBy: { created_at: 'asc' },
    });

    return profiles.map(toProfileSummary);
  }

  async updateProfile(
    userId: string,
    profileId: string,
    dto: UpdateProfileDto,
  ) {
    const existing = await this.prismaService.db.profile.findFirst({
      where: { id: profileId, user_id: userId, is_deleted: false },
      select: { id: true, user: { select: { phone_number: true } } },
    });
    if (!existing) throw new NotFoundException('Profile not found');

    const { first_name, last_name, phone_number } = dto;

    const hasUserFields =
      first_name !== undefined ||
      last_name !== undefined ||
      phone_number !== undefined;

    if (
      phone_number !== undefined &&
      phone_number !== existing.user.phone_number
    ) {
      const collision = await this.prismaService.db.user.findFirst({
        where: {
          phone_number,
          is_deleted: false,
          id: { not: userId },
        },
        select: { id: true },
      });
      if (collision) {
        throw new ConflictException(
          'A user with this phone number already exists',
        );
      }
    }

    if (hasUserFields) {
      await this.prismaService.db.user.update({
        where: { id: userId },
        data: {
          ...(first_name !== undefined && { first_name }),
          ...(last_name !== undefined && { last_name }),
          ...(phone_number !== undefined && { phone_number }),
        },
      });
    }

    const profile = await this.prismaService.db.profile.findUniqueOrThrow({
      where: { id: profileId },
      include: PROFILE_DETAIL_INCLUDE,
    });

    return toProfileDetail(profile);
  }
}

function humanizeEnumValue(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
