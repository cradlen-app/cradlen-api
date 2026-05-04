import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthContext } from '../../common/interfaces/auth-context.interface.js';
import {
  ApiStandardResponse,
  ApiVoidResponse,
} from '../../common/swagger/index.js';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
} from './dto/invitation.dto.js';
import { InvitationsService } from './invitations.service.js';

@ApiTags('Invitations')
@Controller()
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post('organizations/:organizationId/invitations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create staff invitation' })
  @ApiStandardResponse(Object)
  createInvitation(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.createInvitation(
      user.userId,
      user.profileId,
      organizationId,
      dto,
    );
  }

  @Get('organizations/:organizationId/invitations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List organization invitations' })
  @ApiStandardResponse(Object)
  listInvitations(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query('branch_id') branchId?: string,
  ) {
    return this.invitationsService.listInvitations(
      user.profileId,
      organizationId,
      branchId,
    );
  }

  @Post('invitations/accept')
  @Public()
  @ApiOperation({ summary: 'Accept invitation' })
  @ApiStandardResponse(Object)
  acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.invitationsService.acceptInvitation(dto);
  }

  @Get('organizations/:organizationId/invitations/:invitationId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get invitation details' })
  @ApiStandardResponse(Object)
  getInvitation(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitationsService.getInvitation(
      user.profileId,
      organizationId,
      invitationId,
    );
  }

  @Post('organizations/:organizationId/invitations/:invitationId/resend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend invitation email' })
  @ApiVoidResponse()
  resendInvitation(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitationsService.resendInvitation(
      user.profileId,
      organizationId,
      invitationId,
    );
  }

  @Delete('organizations/:organizationId/invitations/:invitationId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel invitation' })
  @ApiStandardResponse(Object)
  cancelInvitation(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitationsService.cancelInvitation(
      user.profileId,
      organizationId,
      invitationId,
    );
  }
}
