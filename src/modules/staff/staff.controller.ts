import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '../../common/swagger/index.js';
import { StaffService } from './staff.service.js';
import { InviteStaffDto } from './dto/invite-staff.dto.js';
import { AcceptInvitationDto } from './dto/accept-invitation.dto.js';
import { UpdateStaffDto } from './dto/update-staff.dto.js';
import { UpdateScheduleDto } from './dto/update-schedule.dto.js';
import {
  ListStaffQueryDto,
  ListInvitationsQueryDto,
} from './dto/list-staff-query.dto.js';
import {
  StaffResponseDto,
  StaffInvitationResponseDto,
  AcceptInvitationResponseDto,
  ScheduleResponseDto,
} from './dto/staff-response.dto.js';

@ApiTags('Staff')
@ApiBearerAuth()
@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  // ── Invitations ──────────────────────────────────────────────────────────

  @Post('invite')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send staff invitation (owner only)' })
  @ApiStandardResponse(StaffInvitationResponseDto)
  sendInvitation(@CurrentUser() user: User, @Body() dto: InviteStaffDto) {
    return this.staffService.sendInvitation(user.id, dto);
  }

  @Get('invitations')
  @ApiOperation({
    summary: 'List invitations for an organization (owner only)',
  })
  @ApiPaginatedResponse(StaffInvitationResponseDto)
  listInvitations(
    @CurrentUser() user: User,
    @Query() query: ListInvitationsQueryDto,
  ) {
    return this.staffService.listInvitations(user.id, query);
  }

  @Delete('invitations/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending invitation (owner only)' })
  cancelInvitation(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('organization_id') organizationId?: string,
  ) {
    return this.staffService.cancelInvitation(user.id, id, organizationId);
  }

  @Post('invitations/:id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend invitation email (owner only)' })
  @ApiStandardResponse(StaffInvitationResponseDto)
  resendInvitation(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('organization_id') organizationId?: string,
  ) {
    return this.staffService.resendInvitation(user.id, id, organizationId);
  }

  @Get('invitations/:id')
  @ApiOperation({ summary: 'Get invitation details (owner only)' })
  @ApiStandardResponse(StaffInvitationResponseDto)
  getInvitation(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('organization_id') organizationId?: string,
  ) {
    return this.staffService.getInvitation(user.id, id, organizationId);
  }

  @Get('invite/preview')
  @Public()
  @ApiOperation({ summary: 'Preview invitation data (public)' })
  @ApiStandardResponse(StaffInvitationResponseDto)
  previewInvitation(
    @Query('token') token: string,
    @Query('invite') inviteId: string,
  ) {
    return this.staffService.previewInvitation(token, inviteId);
  }

  @Post('invite/accept')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Accept invitation and set password (public)' })
  @ApiStandardResponse(AcceptInvitationResponseDto)
  acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.staffService.acceptInvitation(dto);
  }

  // ── Staff management ─────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List active staff for an organization (owner only)',
  })
  @ApiPaginatedResponse(StaffResponseDto)
  listStaff(@CurrentUser() user: User, @Query() query: ListStaffQueryDto) {
    return this.staffService.listStaff(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get staff member details (owner only)' })
  @ApiStandardResponse(StaffResponseDto)
  getStaff(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('organization_id', ParseUUIDPipe) organizationId: string,
  ) {
    return this.staffService.getStaff(user.id, id, organizationId);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update staff role/job title/specialty (owner only)',
  })
  @ApiStandardResponse(StaffResponseDto)
  updateStaff(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('organization_id', ParseUUIDPipe) organizationId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staffService.updateStaff(user.id, id, organizationId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete staff record (owner only)' })
  @ApiVoidResponse()
  deleteStaff(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('organization_id', ParseUUIDPipe) organizationId: string,
  ) {
    return this.staffService.deleteStaff(user.id, id, organizationId);
  }

  // ── Schedule ─────────────────────────────────────────────────────────────

  @Get(':id/schedule')
  @ApiOperation({
    summary: 'Get schedule for a staff branch assignment (owner or self)',
  })
  @ApiStandardResponse(ScheduleResponseDto)
  getSchedule(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('organization_id', ParseUUIDPipe) organizationId: string,
  ) {
    return this.staffService.getSchedule(user.id, id, organizationId);
  }

  @Patch(':id/schedule')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Full replace schedule for a staff branch assignment (owner or self)',
  })
  @ApiVoidResponse()
  updateSchedule(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('organization_id', ParseUUIDPipe) organizationId: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.staffService.updateSchedule(user.id, id, organizationId, dto);
  }
}
