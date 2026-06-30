import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator.js';
import { AdminJwtAuthGuard } from '@common/guards/admin-jwt-auth.guard.js';
import type { AdminAuthContext } from '@common/interfaces/admin-auth-context.interface.js';
import { AdminPushService } from './admin-push.service.js';
import { PushSubscribeDto, PushUnsubscribeDto } from './dto/admin-push.dto.js';

/**
 * Web Push subscription management for the admin dashboard. `@Public()` to skip
 * the org-scoped staff guard, then re-protected by AdminJwtAuthGuard. Each
 * subscription is owned by the calling admin (`adminId` from the JWT).
 */
@ApiTags('Platform Admin')
@ApiBearerAuth()
@Public()
@UseGuards(AdminJwtAuthGuard)
@Controller({ path: 'admin/push', version: '1' })
export class AdminPushController {
  constructor(private readonly push: AdminPushService) {}

  @Post('subscribe')
  @ApiOperation({ summary: 'Register a Web Push subscription for this admin' })
  async subscribe(
    @CurrentAdmin() admin: AdminAuthContext,
    @Body() dto: PushSubscribeDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ success: boolean }> {
    await this.push.subscribe(admin.adminId, dto, userAgent ?? null);
    return { success: true };
  }

  @Post('unsubscribe')
  @ApiOperation({ summary: 'Remove a Web Push subscription' })
  async unsubscribe(
    @CurrentAdmin() admin: AdminAuthContext,
    @Body() dto: PushUnsubscribeDto,
  ): Promise<{ success: boolean }> {
    await this.push.unsubscribe(admin.adminId, dto.endpoint);
    return { success: true };
  }
}
