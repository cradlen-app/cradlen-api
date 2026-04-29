import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthContext } from '../../common/interfaces/auth-context.interface.js';
import { ApiStandardResponse } from '../../common/swagger/index.js';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
} from './dto/invitation.dto.js';
import { InvitationsService } from './invitations.service.js';

@ApiTags('Invitations')
@Controller()
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post('accounts/:accountId/invitations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create staff invitation' })
  @ApiStandardResponse(Object)
  createInvitation(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.createInvitation(
      user.userId,
      user.profileId,
      accountId,
      dto,
    );
  }

  @Get('accounts/:accountId/invitations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List account invitations' })
  @ApiStandardResponse(Object)
  listInvitations(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    return this.invitationsService.listInvitations(user.profileId, accountId);
  }

  @Post('invitations/accept')
  @Public()
  @ApiOperation({ summary: 'Accept invitation' })
  @ApiStandardResponse(Object)
  acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.invitationsService.acceptInvitation(dto);
  }

  @Delete('accounts/:accountId/invitations/:invitationId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel invitation' })
  @ApiStandardResponse(Object)
  cancelInvitation(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitationsService.cancelInvitation(
      user.profileId,
      accountId,
      invitationId,
    );
  }
}
