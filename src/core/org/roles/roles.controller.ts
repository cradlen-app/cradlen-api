import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { ApiStandardResponse } from '@common/swagger/api-responses.decorator.js';
import { RoleResponseDto } from './dto/role-response.dto.js';
import { RolesService } from './roles.service.js';

@ApiTags('Roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Public()
  @Get('lookup')
  @ApiOperation({ summary: 'List roles for dropdowns (public)' })
  @ApiStandardResponse(RoleResponseDto)
  findLookup() {
    return this.rolesService.findLookup();
  }
}
