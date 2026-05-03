import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthContext } from '../../common/interfaces/auth-context.interface.js';
import { ApiStandardResponse } from '../../common/swagger/index.js';
import { CreateStaffDto } from './dto/staff.dto.js';
import { StaffService } from './staff.service.js';

@ApiTags('Staff')
@ApiBearerAuth()
@Controller()
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post('accounts/:accountId/staff')
  @ApiOperation({
    summary: 'Directly create a staff member',
    description:
      'Creates a user + profile immediately. A system email is auto-generated (e.g. sara-ahmed4821@cradlen.com). Staff log in with the password set here.',
  })
  @ApiStandardResponse(Object)
  createStaff(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: CreateStaffDto,
  ) {
    return this.staffService.createStaff(user.profileId, accountId, dto);
  }

  @Get('accounts/:accountId/staff')
  @ApiOperation({ summary: 'List all active staff in an account' })
  @ApiStandardResponse(Object)
  listStaff(
    @CurrentUser() user: AuthContext,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query('branch_id') branchId?: string,
  ) {
    return this.staffService.listStaff(user.profileId, accountId, branchId);
  }
}
