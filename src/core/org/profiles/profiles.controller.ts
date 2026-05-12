import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { ProfilesService } from './profiles.service.js';

@ApiTags('Profiles')
@ApiBearerAuth()
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

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
  @ApiOperation({ summary: 'Update profile information' })
  @ApiStandardResponse(ProfileDetailResponseDto)
  updateProfile(
    @CurrentUser() user: AuthContext,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profilesService.updateProfile(user.userId, profileId, dto);
  }
}
