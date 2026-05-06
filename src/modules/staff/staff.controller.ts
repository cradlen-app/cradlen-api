import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthContext } from '../../common/interfaces/auth-context.interface.js';
import {
  ApiStandardResponse,
  ApiVoidResponse,
} from '../../common/swagger/index.js';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto.js';
import { StaffService } from './staff.service.js';

@ApiTags('Staff')
@ApiBearerAuth()
@Controller()
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post('organizations/:organizationId/staff')
  @ApiOperation({
    summary: 'Directly create a staff member',
    description:
      'Creates a user + profile immediately. A system email is auto-generated (e.g. sara-ahmed4821@cradlen.com). Staff log in with the password set here.',
  })
  @ApiStandardResponse(Object)
  createStaff(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateStaffDto,
  ) {
    return this.staffService.createStaff(user.profileId, organizationId, dto);
  }

  @Get('organizations/:organizationId/staff')
  @ApiOperation({ summary: 'List all active staff in an organization' })
  @ApiStandardResponse(Object)
  listStaff(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query('branch_id') branchId?: string,
    @Query('role') role?: string,
  ) {
    return this.staffService.listStaff(
      user.profileId,
      organizationId,
      branchId,
      role,
    );
  }

  @Patch('organizations/:organizationId/staff/:staffProfileId')
  @ApiOperation({ summary: 'Update a staff member' })
  @ApiStandardResponse(Object)
  updateStaff(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('staffProfileId', ParseUUIDPipe) staffProfileId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staffService.updateStaff(
      user.profileId,
      organizationId,
      staffProfileId,
      dto,
    );
  }

  @Delete('organizations/:organizationId/staff/:staffProfileId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a staff member' })
  @ApiVoidResponse()
  deleteStaff(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('staffProfileId', ParseUUIDPipe) staffProfileId: string,
  ) {
    return this.staffService.deleteStaff(
      user.profileId,
      organizationId,
      staffProfileId,
    );
  }
}
