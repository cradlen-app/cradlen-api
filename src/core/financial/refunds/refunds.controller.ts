import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import { RefundsService } from './refunds.service.js';
import { CreateRefundDto } from './dto/create-refund.dto.js';
import { ListRefundsQueryDto } from './dto/list-refunds-query.dto.js';
import { RefundResponseDto } from './dto/refund-response.dto.js';

@ApiTags('Financial — Refunds')
@ApiBearerAuth()
@Controller('organizations/:orgId/refunds')
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiStandardResponse(RefundResponseDto)
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateRefundDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.refundsService.create(orgId, dto, user);
  }

  @Get()
  @ApiStandardResponse(RefundResponseDto)
  list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ListRefundsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.refundsService.listForInvoice(orgId, query.invoice_id, user);
  }

  @Get(':id')
  @ApiStandardResponse(RefundResponseDto)
  getRefund(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.refundsService.getRefund(orgId, id, user);
  }

  @Post(':id/void')
  @ApiStandardResponse(RefundResponseDto)
  voidRefund(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.refundsService.voidRefund(orgId, id, user);
  }
}
