import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator.js';
import { AdminJwtAuthGuard } from '@common/guards/admin-jwt-auth.guard.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
} from '@common/swagger/index.js';
import type { AdminAuthContext } from '@common/interfaces/admin-auth-context.interface.js';
import { AdminListQueryDto } from '../read/dto/admin-list-query.dto.js';
import { AdminsService } from './admins.service.js';
import { CreateAdminDto } from './dto/create-admin.dto.js';
import { AdminResponseDto } from './dto/admin-response.dto.js';

/**
 * In-app platform-admin management. `@Public()` to bypass the org-scoped staff
 * guard, then re-protected by AdminJwtAuthGuard. Flat tier — any active admin
 * can manage others; the acting admin is threaded into the audit trail.
 */
@ApiTags('Platform Admin')
@ApiBearerAuth()
@Public()
@UseGuards(AdminJwtAuthGuard)
@Controller({ path: 'admin/admins', version: '1' })
export class AdminsController {
  constructor(private readonly admins: AdminsService) {}

  @Get()
  @ApiOperation({ summary: 'List platform admins' })
  @ApiPaginatedResponse(AdminResponseDto)
  list(@Query() query: AdminListQueryDto) {
    return this.admins.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add an admin by email (sends a set-password invite)',
  })
  @ApiStandardResponse(AdminResponseDto)
  create(
    @CurrentAdmin() actor: AdminAuthContext,
    @Body() dto: CreateAdminDto,
  ): Promise<AdminResponseDto> {
    return this.admins.create(actor.adminId, dto);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable an admin account' })
  @ApiStandardResponse(AdminResponseDto)
  disable(
    @CurrentAdmin() actor: AdminAuthContext,
    @Param('id') id: string,
  ): Promise<AdminResponseDto> {
    return this.admins.disable(actor.adminId, id);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-enable a disabled admin account' })
  @ApiStandardResponse(AdminResponseDto)
  enable(
    @CurrentAdmin() actor: AdminAuthContext,
    @Param('id') id: string,
  ): Promise<AdminResponseDto> {
    return this.admins.enable(actor.adminId, id);
  }

  @Post(':id/resend-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-send the set-password invite to a pending admin',
  })
  @ApiStandardResponse(AdminResponseDto)
  resendInvite(
    @CurrentAdmin() actor: AdminAuthContext,
    @Param('id') id: string,
  ): Promise<AdminResponseDto> {
    return this.admins.resendInvite(actor.adminId, id);
  }
}
