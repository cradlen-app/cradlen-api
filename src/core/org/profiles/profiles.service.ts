import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EngagementType, ExecutiveTitle } from '@prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service.js';
import { StorageService } from '@infrastructure/storage/storage.service.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import type {
  ConfirmProfileImageDto,
  ProfileImageUploadDto,
  ProfileImageUploadUrlDto,
} from './dto/profile-image.dto.js';
import {
  PROFILE_DETAIL_INCLUDE,
  PROFILE_SUMMARY_INCLUDE,
  type ProfileDetail,
} from './profiles.includes.js';
import { toProfileDetail, toProfileSummary } from './profiles.mapper.js';

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  /** Object-key prefix that scopes an avatar to one profile. */
  private avatarPrefix(profileId: string): string {
    return `profiles/${profileId}/avatar/`;
  }

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

    // PROFILE-LEVEL: free-text display title. Empty string clears it.
    if (dto.professional_title !== undefined) {
      const title = dto.professional_title?.trim();
      await this.prismaService.db.profile.update({
        where: { id: profileId },
        data: { professional_title: title ? title : null },
      });
    }

    const profile = await this.prismaService.db.profile.findUniqueOrThrow({
      where: { id: profileId },
      include: PROFILE_DETAIL_INCLUDE,
    });

    return this.toDetailWithImage(profile);
  }

  /**
   * Issues a short-lived presigned PUT URL for the profile's avatar. Images
   * only; the key is server-derived and scoped to the caller-owned profile.
   */
  async createImageUploadUrl(
    userId: string,
    profileId: string,
    dto: ProfileImageUploadDto,
  ): Promise<ProfileImageUploadUrlDto> {
    await this.assertOwnedProfile(userId, profileId);

    this.assertImageContentType(dto.content_type);
    this.storageService.assertAllowedContentType(dto.content_type);
    this.storageService.assertWithinSizeLimit(dto.size_bytes);

    const ext = this.storageService.extensionFor(dto.content_type);
    const key = `${this.avatarPrefix(profileId)}${randomUUID()}.${ext}`;

    const { url, expiresIn } =
      await this.storageService.createPresignedUploadUrl({
        key,
        contentType: dto.content_type,
      });

    return {
      key,
      upload_url: url,
      expires_in: expiresIn,
      content_type: dto.content_type,
    };
  }

  /**
   * Confirms an uploaded avatar: validates the key belongs to this profile and
   * the object actually landed in R2, sets it, and best-effort removes the
   * previously stored image.
   */
  async confirmImage(
    userId: string,
    profileId: string,
    dto: ConfirmProfileImageDto,
  ) {
    const existing = await this.assertOwnedProfile(userId, profileId);

    if (!dto.key.startsWith(this.avatarPrefix(profileId))) {
      throw new BadRequestException('Invalid image key');
    }

    const head = await this.storageService.headObject(dto.key);
    if (!head) {
      throw new BadRequestException('Uploaded file not found');
    }
    if (head.contentType) {
      this.assertImageContentType(head.contentType);
      this.storageService.assertAllowedContentType(head.contentType);
    }
    if (typeof head.contentLength === 'number') {
      this.storageService.assertWithinSizeLimit(head.contentLength);
    }

    const previousKey = existing.profile_image_object_key;

    await this.prismaService.db.profile.update({
      where: { id: profileId },
      data: { profile_image_object_key: dto.key },
    });

    if (previousKey && previousKey !== dto.key) {
      await this.bestEffortDelete(previousKey);
    }

    return this.loadDetailWithImage(profileId);
  }

  /** Clears the profile's avatar and best-effort removes the R2 object. */
  async removeImage(userId: string, profileId: string) {
    const existing = await this.assertOwnedProfile(userId, profileId);
    const previousKey = existing.profile_image_object_key;

    await this.prismaService.db.profile.update({
      where: { id: profileId },
      data: { profile_image_object_key: null },
    });

    if (previousKey) {
      await this.bestEffortDelete(previousKey);
    }

    return this.loadDetailWithImage(profileId);
  }

  /** Loads the caller-owned profile (404 otherwise); returns id + current key. */
  private async assertOwnedProfile(userId: string, profileId: string) {
    const profile = await this.prismaService.db.profile.findFirst({
      where: { id: profileId, user_id: userId, is_deleted: false },
      select: { id: true, profile_image_object_key: true },
    });
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  private async loadDetailWithImage(profileId: string) {
    const profile = await this.prismaService.db.profile.findUniqueOrThrow({
      where: { id: profileId },
      include: PROFILE_DETAIL_INCLUDE,
    });
    return this.toDetailWithImage(profile);
  }

  /** Maps a profile detail row and attaches a presigned avatar GET URL. */
  private async toDetailWithImage(profile: ProfileDetail) {
    const key = profile.profile_image_object_key;
    const profile_image_url = key
      ? await this.storageService.createPresignedDownloadUrl(key)
      : null;
    return { ...toProfileDetail(profile), profile_image_url };
  }

  private assertImageContentType(contentType: string): void {
    if (!contentType.startsWith('image/')) {
      throw new BadRequestException('Profile image must be an image file');
    }
  }

  private async bestEffortDelete(key: string): Promise<void> {
    try {
      await this.storageService.deleteObject(key);
    } catch {
      this.logger.warn(`Failed to delete previous avatar object ${key}`);
    }
  }
}

function humanizeEnumValue(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
