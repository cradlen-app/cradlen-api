import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import { Public } from '@common/decorators/public.decorator.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { ProfileResponseDto } from './dto/profile-response.dto.js';
import { ProfileDetailResponseDto } from './dto/profile-detail-response.dto.js';
import { ProfileLookupsDto } from './dto/profile-lookups.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import {
  ConfirmProfileImageDto,
  ProfileImageUploadDto,
  ProfileImageUploadUrlDto,
} from './dto/profile-image.dto.js';
import { ProfilesService } from './profiles.service.js';

@ApiTags('Profiles')
@ApiBearerAuth()
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  // Public: the signup wizard renders these enums before the user has a token.
  @Public()
  @Get('lookups')
  @ApiOperation({
    summary: 'List profile enum lookups (executive titles, engagement types)',
  })
  @ApiStandardResponse(ProfileLookupsDto)
  getLookups() {
    return this.profilesService.getEnumLookups();
  }

  @Get()
  @ApiOperation({ summary: 'List current user profiles' })
  @ApiStandardResponse(ProfileResponseDto)
  listProfiles(@CurrentUser() user: AuthContext) {
    return this.profilesService.listProfiles(user.userId);
  }

  @Patch(':profileId')
  @ApiOperation({
    summary: 'Update profile information',
    description:
      'Updates the caller-owned profile. first_name, last_name, and phone_number live on the underlying User and therefore apply to every organization this user belongs to. Privileged fields (roles, job functions, specialties, executive_title, engagement_type) are managed via /organizations/:orgId/staff and invitations, not here.',
  })
  @ApiStandardResponse(ProfileDetailResponseDto)
  updateProfile(
    @CurrentUser() user: AuthContext,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profilesService.updateProfile(user.userId, profileId, dto);
  }

  @Post(':profileId/image-upload-url')
  @ApiOperation({
    summary: "Get a presigned URL to upload the profile's avatar",
  })
  @ApiStandardResponse(ProfileImageUploadUrlDto)
  createImageUploadUrl(
    @CurrentUser() user: AuthContext,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: ProfileImageUploadDto,
  ) {
    return this.profilesService.createImageUploadUrl(
      user.userId,
      profileId,
      dto,
    );
  }

  @Post(':profileId/image')
  @ApiOperation({ summary: 'Confirm an uploaded profile avatar' })
  @ApiStandardResponse(ProfileDetailResponseDto)
  confirmImage(
    @CurrentUser() user: AuthContext,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: ConfirmProfileImageDto,
  ) {
    return this.profilesService.confirmImage(user.userId, profileId, dto);
  }

  @Delete(':profileId/image')
  @ApiOperation({ summary: "Remove the profile's avatar" })
  @ApiStandardResponse(ProfileDetailResponseDto)
  removeImage(
    @CurrentUser() user: AuthContext,
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ) {
    return this.profilesService.removeImage(user.userId, profileId);
  }
}
