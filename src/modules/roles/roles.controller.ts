import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { RoleResponseDto } from './dto/role-response.dto';
import { ApiStandardResponse } from '../../common/swagger/api-responses.decorator';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'List all roles' })
  @ApiStandardResponse(RoleResponseDto)
  listRoles() {
    return this.rolesService.listRoles();
  }
}
