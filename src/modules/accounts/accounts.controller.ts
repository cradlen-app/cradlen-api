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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthContext } from '../../common/interfaces/auth-context.interface.js';
import {
  ApiStandardResponse,
  ApiVoidResponse,
} from '../../common/swagger/index.js';
import { AccountsService } from './accounts.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { UpdateAccountDto } from './dto/update-account.dto.js';

@ApiTags('Accounts')
@ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new account (organization)' })
  @ApiStandardResponse(Object)
  createAccount(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateAccountDto,
  ) {
    return this.accountsService.createAccount(user.userId, dto);
  }

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

  @Delete(':accountId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete account (organization) and all its data' })
  @ApiVoidResponse()
  deleteAccount(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    return this.accountsService.deleteAccount(user.profileId, accountId);
  }
}
