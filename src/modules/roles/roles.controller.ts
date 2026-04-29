import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthContext } from '../../common/interfaces/auth-context.interface.js';
import { ApiStandardResponse } from '../../common/swagger/api-responses.decorator.js';
import { RoleResponseDto } from './dto/role-response.dto.js';
import { RolesService } from './roles.service.js';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller('accounts/:accountId/roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'List roles for an account' })
  @ApiStandardResponse(RoleResponseDto)
  listRoles(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    return this.rolesService.listRoles(user.profileId, accountId);
  }
}
