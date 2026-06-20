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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '@common/swagger/index.js';
import { PermissionGuard } from '@common/guards/permission.guard.js';
import { RequirePermission } from '@common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '@common/authorization/permission-matrix.js';
import {
  CreateStaffDto,
  CreateStaffResponseDto,
  ListStaffQueryDto,
  ResetStaffPasswordDto,
  StaffResponseDto,
  UpdateStaffDto,
} from './dto/staff.dto.js';
import { StaffStatsDto } from './dto/staff-stats.dto.js';
import { StaffService } from './staff.service.js';

@ApiTags('Staff')
@ApiBearerAuth()
@Controller('organizations/:organizationId/branches/:branchId/staff')
// Coarse capability gate matching the frontend `staff.*` nav/route. Per-branch
// scoping + owner-only privileged-role rules stay in the service layer.
@UseGuards(PermissionGuard)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  @RequirePermission(PERMISSIONS.staffManage)
  @ApiOperation({
    summary: 'Directly create a staff member in a branch',
    description:
      'Creates a user + profile immediately, assigned to this branch (plus any extra branch_ids). A system email is auto-generated (e.g. sara-ahmed4821@cradlen.com). Staff log in with the password set here.',
  })
  @ApiStandardResponse(CreateStaffResponseDto)
  createStaff(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: CreateStaffDto,
  ) {
    return this.staffService.createStaff(
      user.profileId,
      organizationId,
      branchId,
      dto,
    );
  }

  @Get()
  @RequirePermission(PERMISSIONS.staffRead)
  @ApiOperation({ summary: 'List active staff assigned to a branch' })
  @ApiPaginatedResponse(StaffResponseDto)
  listStaff(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListStaffQueryDto,
  ) {
    return this.staffService.listStaff(
      user.profileId,
      organizationId,
      branchId,
      query,
    );
  }

  @Get('stats')
  @RequirePermission(PERMISSIONS.staffRead)
  @ApiOperation({
    summary: 'Branch staff analytics (total + per-role + clinical, with trend)',
    description:
      'Returns active-staff counts for this branch — a total, a data-driven per-role breakdown, and a clinical subtotal — each with the value at the start of the current month so the client can show a month-over-month trend.',
  })
  @ApiStandardResponse(StaffStatsDto)
  staffStats(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.staffService.getBranchStats(
      user.profileId,
      organizationId,
      branchId,
    );
  }

  @Patch(':staffProfileId')
  @RequirePermission(PERMISSIONS.staffManage)
  @ApiOperation({ summary: 'Update a staff member within a branch' })
  @ApiStandardResponse(StaffResponseDto)
  updateStaff(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('staffProfileId', ParseUUIDPipe) staffProfileId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staffService.updateStaff(
      user.profileId,
      organizationId,
      branchId,
      staffProfileId,
      dto,
    );
  }

  @Post(':staffProfileId/reset-password')
  @RequirePermission(PERMISSIONS.staffManage)
  @HttpCode(204)
  @ApiOperation({
    summary: "Reset a staff member's password",
    description:
      "Sets a new login password for a staff member (admin shares it out-of-band). Intended for staff created with a system-generated email who cannot use the email-OTP reset flow. Revokes the staff member's active sessions. Available to OWNER and to BRANCH_MANAGER on their own branches (a BRANCH_MANAGER cannot reset an OWNER or BRANCH_MANAGER).",
  })
  @ApiVoidResponse()
  resetStaffPassword(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('staffProfileId', ParseUUIDPipe) staffProfileId: string,
    @Body() dto: ResetStaffPasswordDto,
  ): Promise<void> {
    return this.staffService.resetStaffPassword(
      user.profileId,
      organizationId,
      branchId,
      staffProfileId,
      dto,
    );
  }

  @Delete(':staffProfileId')
  @RequirePermission(PERMISSIONS.staffManage)
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove a staff member from a branch',
    description:
      "Removes the staff/branch link. Other branch assignments remain intact. If this was the staff member's last remaining branch, the profile is soft-deleted in the same transaction. Available to OWNER and to BRANCH_MANAGER on their own branches.",
  })
  @ApiVoidResponse()
  removeStaffFromBranch(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('staffProfileId', ParseUUIDPipe) staffProfileId: string,
  ): Promise<void> {
    return this.staffService.removeStaffFromBranch(
      user.profileId,
      organizationId,
      branchId,
      staffProfileId,
    );
  }
}
