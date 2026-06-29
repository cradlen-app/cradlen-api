import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator.js';
import { AdminJwtAuthGuard } from '@common/guards/admin-jwt-auth.guard.js';
import type { AdminAuthContext } from '@common/interfaces/admin-auth-context.interface.js';
import { AdminWriteService } from './admin-write.service.js';
import {
  ChangePlanDto,
  ExtendSubscriptionDto,
  ReasonDto,
  RejectPaymentDto,
  ResetPasswordDto,
} from './dto/admin-write.dto.js';

/**
 * Platform-admin write actions across tenants. Every route is `@Public()` to
 * bypass the org-scoped staff guard, then re-protected by AdminJwtAuthGuard.
 * The acting admin id (`@CurrentAdmin`) is threaded into every audit row.
 */
@ApiTags('Platform Admin')
@ApiBearerAuth()
@Public()
@UseGuards(AdminJwtAuthGuard)
@Controller({ path: 'admin', version: '1' })
export class AdminWriteController {
  constructor(private readonly writeService: AdminWriteService) {}

  // Payments
  @Post('subscription-payments/:id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a subscription payment (activates the plan)',
  })
  verifyPayment(
    @CurrentAdmin() admin: AdminAuthContext,
    @Param('id') id: string,
  ) {
    return this.writeService.verifyPayment(admin.adminId, id);
  }

  @Post('subscription-payments/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a subscription payment' })
  rejectPayment(
    @CurrentAdmin() admin: AdminAuthContext,
    @Param('id') id: string,
    @Body() dto: RejectPaymentDto,
  ) {
    return this.writeService.rejectPayment(admin.adminId, id, dto.reason);
  }

  // Subscriptions
  @Post('subscriptions/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend a subscription (blocks org writes)' })
  suspendSubscription(
    @CurrentAdmin() admin: AdminAuthContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.writeService.suspendSubscription(admin.adminId, id, dto.reason);
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a subscription' })
  cancelSubscription(
    @CurrentAdmin() admin: AdminAuthContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.writeService.cancelSubscription(admin.adminId, id, dto.reason);
  }

  @Post('subscriptions/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a suspended/cancelled subscription' })
  reactivateSubscription(
    @CurrentAdmin() admin: AdminAuthContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.writeService.reactivateSubscription(
      admin.adminId,
      id,
      dto.reason,
    );
  }

  @Post('subscriptions/:id/extend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Extend a subscription end date by N days' })
  extendSubscription(
    @CurrentAdmin() admin: AdminAuthContext,
    @Param('id') id: string,
    @Body() dto: ExtendSubscriptionDto,
  ) {
    return this.writeService.extendSubscription(admin.adminId, id, dto.days);
  }

  @Post('subscriptions/:id/change-plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Switch a subscription to a different plan' })
  changePlan(
    @CurrentAdmin() admin: AdminAuthContext,
    @Param('id') id: string,
    @Body() dto: ChangePlanDto,
  ) {
    return this.writeService.changePlan(admin.adminId, id, dto.plan);
  }

  // Organizations
  @Post('organizations/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend an organization' })
  suspendOrganization(
    @CurrentAdmin() admin: AdminAuthContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.writeService.suspendOrganization(admin.adminId, id, dto.reason);
  }

  @Post('organizations/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate an organization' })
  reactivateOrganization(
    @CurrentAdmin() admin: AdminAuthContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.writeService.reactivateOrganization(
      admin.adminId,
      id,
      dto.reason,
    );
  }

  // Users
  @Post('users/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a user account' })
  deactivateUser(
    @CurrentAdmin() admin: AdminAuthContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.writeService.deactivateUser(admin.adminId, id, dto.reason);
  }

  @Post('users/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a user account' })
  reactivateUser(
    @CurrentAdmin() admin: AdminAuthContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.writeService.reactivateUser(admin.adminId, id, dto.reason);
  }

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reset a user's password" })
  resetUserPassword(
    @CurrentAdmin() admin: AdminAuthContext,
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.writeService.resetUserPassword(
      admin.adminId,
      id,
      dto.new_password,
    );
  }
}
