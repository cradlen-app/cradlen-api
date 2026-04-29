import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ApiStandardResponse } from '../../common/swagger/index.js';
import type { AuthContext } from '../../common/interfaces/auth-context.interface.js';
import { ProfileResponseDto } from './dto/profile-response.dto.js';
import { ProfilesService } from './profiles.service.js';

@ApiTags('Profiles')
@ApiBearerAuth()
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get()
  @ApiOperation({ summary: 'List current user profiles' })
  @ApiStandardResponse(ProfileResponseDto)
  listProfiles(@CurrentUser() user: AuthContext) {
    return this.profilesService.listProfiles(user.userId);
  }
}
