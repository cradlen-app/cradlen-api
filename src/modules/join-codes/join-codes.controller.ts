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
import { AcceptJoinCodeDto, CreateJoinCodeDto } from './dto/join-code.dto.js';
import { JoinCodesService } from './join-codes.service.js';

@ApiTags('Join Codes')
@Controller()
export class JoinCodesController {
  constructor(private readonly joinCodesService: JoinCodesService) {}

  @Post('accounts/:accountId/join-codes')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate join code' })
  @ApiStandardResponse(Object)
  createJoinCode(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: CreateJoinCodeDto,
  ) {
    return this.joinCodesService.createJoinCode(
      user.userId,
      user.profileId,
      accountId,
      dto,
    );
  }

  @Get('accounts/:accountId/join-codes')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List join codes' })
  @ApiStandardResponse(Object)
  listJoinCodes(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    return this.joinCodesService.listJoinCodes(user.profileId, accountId);
  }

  @Post('join-codes/accept')
  @Public()
  @ApiOperation({ summary: 'Join account by code' })
  @ApiStandardResponse(Object)
  acceptJoinCode(@Body() dto: AcceptJoinCodeDto) {
    return this.joinCodesService.acceptJoinCode(dto);
  }

  @Delete('accounts/:accountId/join-codes/:joinCodeId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke join code' })
  @ApiStandardResponse(Object)
  revokeJoinCode(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('joinCodeId', ParseUUIDPipe) joinCodeId: string,
  ) {
    return this.joinCodesService.revokeJoinCode(
      user.profileId,
      accountId,
      joinCodeId,
    );
  }
}
