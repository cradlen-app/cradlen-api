import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { AdminJwtAuthGuard } from '@common/guards/admin-jwt-auth.guard.js';
import { ApiPaginatedResponse } from '@common/swagger/index.js';
import { AdminNotificationsService } from './admin-notifications.service.js';
import {
  AdminNotificationDto,
  AdminNotificationsQueryDto,
} from './dto/admin-notification.dto.js';

/**
 * Platform-wide admin notification feed. `@Public()` to bypass the org-scoped
 * staff guard, then re-protected by AdminJwtAuthGuard. List responses carry an
 * `unread_count` in `meta` for the bell badge.
 */
@ApiTags('Platform Admin')
@ApiBearerAuth()
@Public()
@UseGuards(AdminJwtAuthGuard)
@Controller({ path: 'admin/notifications', version: '1' })
export class AdminNotificationsController {
  constructor(private readonly notifications: AdminNotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List admin notifications (newest first)' })
  @ApiPaginatedResponse(AdminNotificationDto)
  list(@Query() query: AdminNotificationsQueryDto) {
    return this.notifications.list(query);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  async markRead(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.notifications.markRead(id);
    return { success: true };
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllRead(): Promise<{ success: boolean }> {
    await this.notifications.markAllRead();
    return { success: true };
  }
}
