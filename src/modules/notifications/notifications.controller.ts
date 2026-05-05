import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthContext } from '../../common/interfaces/auth-context.interface.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '../../common/swagger/index.js';
import {
  ListNotificationsQueryDto,
  NotificationDto,
} from './dto/notification.dto.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiPaginatedResponse(NotificationDto)
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notificationsService.list(
      user.userId,
      query.page,
      query.limit,
      query.category,
    );
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  markAllRead(@CurrentUser() user: AuthContext) {
    return this.notificationsService.markAllRead(user.userId);
  }

  @Patch(':id/read')
  @ApiStandardResponse(NotificationDto)
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.notificationsService.markRead(id, user.userId);
  }
}
