import { Controller, Get, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { RolesService } from './roles.service';
import { RoleResponseDto } from './dto/role-response.dto';
import { ApiStandardResponse } from '../../common/swagger/api-responses.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'List roles for an organization (owner only)' })
  @ApiStandardResponse(RoleResponseDto)
  listRoles(
    @CurrentUser() user: User,
    @Query('organization_id', ParseUUIDPipe) organizationId: string,
  ) {
    return this.rolesService.listRoles(user.id, organizationId);
  }
}
