import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { PushService } from './push.service.js';
import { PushSubscribeDto, PushUnsubscribeDto } from './dto/push.dto.js';

/**
 * Web Push subscription management for staff. Protected by the same global staff
 * JWT guard as the rest of the notifications API; each subscription is owned by
 * the calling profile (`profileId` from the auth context).
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('subscribe')
  @ApiOperation({
    summary: 'Register a Web Push subscription for the current staff profile',
  })
  async subscribe(
    @CurrentUser() user: AuthContext,
    @Body() dto: PushSubscribeDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ success: boolean }> {
    await this.push.subscribe(user.profileId, dto, userAgent ?? null);
    return { success: true };
  }

  @Post('unsubscribe')
  @ApiOperation({ summary: 'Remove a Web Push subscription' })
  async unsubscribe(
    @CurrentUser() user: AuthContext,
    @Body() dto: PushUnsubscribeDto,
  ): Promise<{ success: boolean }> {
    await this.push.unsubscribe(user.profileId, dto.endpoint);
    return { success: true };
  }
}
