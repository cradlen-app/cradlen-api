import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import { PaymentsService } from './payments.service.js';
import { RecordPaymentDto } from './dto/record-payment.dto.js';
import { PaymentResponseDto } from './dto/payment-response.dto.js';
import { PaymentResultDto } from './dto/payment-result.dto.js';

@ApiTags('Financial — Payments')
@ApiBearerAuth()
@Controller('organizations/:orgId/invoices/:invoiceId/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiStandardResponse(PaymentResultDto)
  recordPayment(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.paymentsService.recordPayment(orgId, invoiceId, dto, user);
  }

  @Get()
  @ApiStandardResponse(PaymentResponseDto)
  findPayments(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.paymentsService.findPayments(orgId, invoiceId, user);
  }

  @Get(':paymentId')
  @ApiStandardResponse(PaymentResponseDto)
  getPayment(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.paymentsService.getPayment(orgId, invoiceId, paymentId, user);
  }

  @Post(':paymentId/void')
  @ApiStandardResponse(PaymentResultDto)
  voidPayment(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.paymentsService.voidPayment(orgId, invoiceId, paymentId, user);
  }
}
