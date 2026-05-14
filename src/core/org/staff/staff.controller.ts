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
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '@common/swagger/index.js';
import {
  CreateStaffDto,
  CreateStaffResponseDto,
  ListStaffQueryDto,
  StaffResponseDto,
  UpdateStaffDto,
} from './dto/staff.dto.js';
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
  @ApiStandardResponse(CreateStaffResponseDto)
  createStaff(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateStaffDto,
  ) {
    return this.staffService.createStaff(user.profileId, organizationId, dto);
  }

  @Get('organizations/:organizationId/staff')
  @ApiOperation({ summary: 'List active staff in an organization' })
  @ApiPaginatedResponse(StaffResponseDto)
  listStaff(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() query: ListStaffQueryDto,
  ) {
    return this.staffService.listStaff(
      user.profileId,
      organizationId,
      query.branch_id,
      query.role,
      query.page,
      query.limit,
      query.scope,
      query.clinical,
      query.doctors_only,
      query.specialty_code,
    );
  }

  @Patch('organizations/:organizationId/staff/:staffProfileId')
  @ApiOperation({ summary: 'Update a staff member' })
  @ApiStandardResponse(StaffResponseDto)
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
  @ApiOperation({
    summary: 'Soft-delete a staff member (OWNER only)',
    description:
      'Removes the staff member from the organization entirely. BRANCH_MANAGER cannot perform this — use the per-branch unassign endpoint instead.',
  })
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

  @Delete(
    'organizations/:organizationId/staff/:staffProfileId/branches/:branchId',
  )
  @HttpCode(204)
  @ApiOperation({
    summary: 'Unassign a staff member from a single branch',
    description:
      'Removes the staff/branch link only. The profile and other branch assignments remain intact. Available to OWNER and to BRANCH_MANAGER on their own branches.',
  })
  @ApiVoidResponse()
  unassignStaffFromBranch(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('staffProfileId', ParseUUIDPipe) staffProfileId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.staffService.unassignStaffFromBranch(
      user.profileId,
      organizationId,
      staffProfileId,
      branchId,
    );
  }
}
