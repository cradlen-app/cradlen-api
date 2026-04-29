import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ApiStandardResponse } from '../../common/swagger/index.js';
import { AccountService } from './account.service.js';
import { UpdateAccountProfileDto } from './dto/update-account-profile.dto.js';
import { DeactivateAccountDto } from './dto/deactivate-account.dto.js';

@ApiTags('Account')
@ApiBearerAuth()
@Controller('account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Patch('profile')
  @ApiOperation({ summary: 'Update current account profile settings' })
  @ApiStandardResponse(Object)
  updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateAccountProfileDto,
  ) {
    return this.accountService.updateProfile(user.id, dto);
  }

  @Post('deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate current account' })
  @ApiStandardResponse(Object)
  deactivate(@CurrentUser() user: User, @Body() dto: DeactivateAccountDto) {
    return this.accountService.deactivate(user.id, dto);
  }
}
