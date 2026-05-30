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
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import { Public } from '@common/decorators/public.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  ApiStandardArrayResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '@common/swagger/index.js';
import {
  AcceptInvitationDto,
  AcceptInvitationResponseDto,
  BulkCreateInvitationsDto,
  BulkInviteResponseDto,
  CreateInvitationDto,
  DeclineInvitationDto,
  InvitationPreviewResponseDto,
  InvitationResponseDto,
  PreviewInvitationQueryDto,
} from './dto/invitation.dto.js';
import { InvitationsService } from './invitations.service.js';

@ApiTags('Invitations')
@Controller()
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post('organizations/:organizationId/branches/:branchId/invitations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create staff invitation (branch-scoped)' })
  @ApiStandardResponse(InvitationResponseDto)
  createInvitation(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.createInvitation(
      user.userId,
      user.profileId,
      organizationId,
      branchId,
      dto,
    );
  }

  @Post('organizations/:organizationId/branches/:branchId/invitations/bulk')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bulk-create staff invitations (branch-scoped)',
    description:
      'Creates all invitations in a single transaction (rolls back on any DB error). Every item must include the path branchId in its branch_ids. Emails are sent after commit; per-email failures are returned in the response.',
  })
  @ApiStandardResponse(BulkInviteResponseDto)
  bulkCreateInvitations(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: BulkCreateInvitationsDto,
  ) {
    return this.invitationsService.bulkCreateInvitations(
      user.userId,
      user.profileId,
      organizationId,
      branchId,
      dto,
    );
  }

  @Get('organizations/:organizationId/branches/:branchId/invitations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List branch invitations' })
  @ApiStandardArrayResponse(InvitationResponseDto)
  listInvitations(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.invitationsService.listInvitations(
      user.profileId,
      organizationId,
      branchId,
    );
  }

  @Get('invitations/preview')
  @Public()
  @ApiOperation({ summary: 'Get public invitation preview (no auth required)' })
  @ApiStandardResponse(InvitationPreviewResponseDto)
  previewInvitation(@Query() query: PreviewInvitationQueryDto) {
    return this.invitationsService.previewInvitation(query);
  }

  @Post('invitations/accept')
  @Public()
  @ApiOperation({ summary: 'Accept invitation' })
  @ApiStandardResponse(AcceptInvitationResponseDto)
  acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.invitationsService.acceptInvitation(dto);
  }

  @Post('invitations/decline')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline invitation' })
  @ApiStandardResponse(Object)
  declineInvitation(@Body() dto: DeclineInvitationDto) {
    return this.invitationsService.declineInvitation(dto);
  }

  @Get(
    'organizations/:organizationId/branches/:branchId/invitations/:invitationId',
  )
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get invitation details' })
  @ApiStandardResponse(InvitationResponseDto)
  getInvitation(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitationsService.getInvitation(
      user.profileId,
      organizationId,
      branchId,
      invitationId,
    );
  }

  @Post(
    'organizations/:organizationId/branches/:branchId/invitations/:invitationId/resend',
  )
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend invitation email' })
  @ApiVoidResponse()
  resendInvitation(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitationsService.resendInvitation(
      user.profileId,
      organizationId,
      branchId,
      invitationId,
    );
  }

  @Delete(
    'organizations/:organizationId/branches/:branchId/invitations/:invitationId',
  )
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel invitation' })
  @ApiStandardResponse(InvitationResponseDto)
  cancelInvitation(
    @CurrentUser() user: AuthContext,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitationsService.cancelInvitation(
      user.profileId,
      organizationId,
      branchId,
      invitationId,
    );
  }
}
