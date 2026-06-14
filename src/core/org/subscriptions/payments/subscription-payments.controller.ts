import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
} from '@common/swagger/index.js';
import { SubscriptionPaymentsService } from './subscription-payments.service.js';
import { SkipSubscriptionCheck } from '../skip-subscription-check.decorator.js';
import { CreateSubscriptionPaymentDto } from './dto/create-subscription-payment.dto.js';
import { ListSubscriptionPaymentsQueryDto } from './dto/list-subscription-payments-query.dto.js';
import { SubscriptionPaymentResponseDto } from './dto/subscription-payment-response.dto.js';
import { CreateSubscriptionPaymentResponseDto } from './dto/create-subscription-payment-response.dto.js';

@ApiTags('Subscription Payments')
@ApiBearerAuth()
@SkipSubscriptionCheck()
@Controller('organizations/:orgId/subscription/payments')
export class SubscriptionPaymentsController {
  constructor(private readonly paymentsService: SubscriptionPaymentsService) {}

  @Post()
  @ApiStandardResponse(CreateSubscriptionPaymentResponseDto)
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateSubscriptionPaymentDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.paymentsService.create(orgId, dto, user);
  }

  @Get()
  @ApiPaginatedResponse(SubscriptionPaymentResponseDto)
  list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ListSubscriptionPaymentsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.paymentsService.list(orgId, query, user);
  }

  @Get(':id')
  @ApiStandardResponse(SubscriptionPaymentResponseDto)
  get(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.paymentsService.get(orgId, id, user);
  }

  @Post(':id/cancel')
  @ApiStandardResponse(SubscriptionPaymentResponseDto)
  cancel(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.paymentsService.cancel(orgId, id, user);
  }
}
