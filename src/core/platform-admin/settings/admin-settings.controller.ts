import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { AdminJwtAuthGuard } from '@common/guards/admin-jwt-auth.guard.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import { AdminSettingsService } from './admin-settings.service.js';
import {
  AdminSettingsDto,
  UpdateAdminSettingsDto,
} from './dto/admin-settings.dto.js';

/**
 * Platform configuration surfaced on the admin Settings page. `@Public()` to
 * bypass the org-scoped staff guard, then re-protected by AdminJwtAuthGuard.
 */
@ApiTags('Platform Admin')
@ApiBearerAuth()
@Public()
@UseGuards(AdminJwtAuthGuard)
@Controller({ path: 'admin/settings', version: '1' })
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get platform settings' })
  @ApiStandardResponse(AdminSettingsDto)
  get(): Promise<AdminSettingsDto> {
    return this.settings.get();
  }

  @Patch()
  @ApiOperation({ summary: 'Update platform settings' })
  @ApiStandardResponse(AdminSettingsDto)
  update(@Body() dto: UpdateAdminSettingsDto): Promise<AdminSettingsDto> {
    return this.settings.update(dto);
  }
}
