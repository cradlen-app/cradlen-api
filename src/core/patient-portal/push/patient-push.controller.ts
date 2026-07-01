import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { CurrentPatient } from '@common/decorators/current-patient.decorator.js';
import { PatientJwtAuthGuard } from '@common/guards/patient-jwt-auth.guard.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientPushService } from './patient-push.service.js';
import { PushSubscribeDto, PushUnsubscribeDto } from './dto/patient-push.dto.js';

/**
 * Web Push subscription management for the patient portal. `@Public()` to skip
 * the org-scoped staff guard, then re-protected by PatientJwtAuthGuard. Each
 * subscription is owned by the calling login account (`accountId` from the JWT),
 * so a guardian's device is reachable for every dependent they manage.
 */
@ApiTags('Patient Portal')
@ApiBearerAuth()
@Public()
@UseGuards(PatientJwtAuthGuard)
@Controller({ path: 'patient-portal/push', version: '1' })
export class PatientPushController {
  constructor(private readonly push: PatientPushService) {}

  @Post('subscribe')
  @ApiOperation({ summary: 'Register a Web Push subscription for this account' })
  async subscribe(
    @CurrentPatient() patient: PatientAuthContext,
    @Body() dto: PushSubscribeDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ success: boolean }> {
    await this.push.subscribe(patient.accountId, dto, userAgent ?? null);
    return { success: true };
  }

  @Post('unsubscribe')
  @ApiOperation({ summary: 'Remove a Web Push subscription' })
  async unsubscribe(
    @CurrentPatient() patient: PatientAuthContext,
    @Body() dto: PushUnsubscribeDto,
  ): Promise<{ success: boolean }> {
    await this.push.unsubscribe(patient.accountId, dto.endpoint);
    return { success: true };
  }
}
