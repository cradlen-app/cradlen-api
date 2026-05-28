import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger/api-responses.decorator.js';
import { RoleResponseDto } from './dto/role-response.dto.js';
import { RolesService } from './roles.service.js';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get('lookup')
  @ApiOperation({ summary: 'List roles for dropdowns' })
  @ApiStandardResponse(RoleResponseDto)
  findLookup() {
    return this.rolesService.findLookup();
  }
}
