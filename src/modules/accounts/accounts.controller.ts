import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthContext } from '../../common/interfaces/auth-context.interface.js';
import { ApiStandardResponse } from '../../common/swagger/index.js';
import { AccountsService } from './accounts.service.js';
import { UpdateAccountDto } from './dto/update-account.dto.js';

@ApiTags('Accounts')
@ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get(':accountId')
  @ApiOperation({ summary: 'Get account details' })
  @ApiStandardResponse(Object)
  getAccount(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    return this.accountsService.getAccount(user.profileId, accountId);
  }

  @Patch(':accountId')
  @ApiOperation({ summary: 'Update account details' })
  @ApiStandardResponse(Object)
  updateAccount(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accountsService.updateAccount(user.profileId, accountId, dto);
  }
}
