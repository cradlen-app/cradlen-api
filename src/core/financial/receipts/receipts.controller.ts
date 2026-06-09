import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import { ReceiptsService } from './receipts.service.js';
import { ReceiptResponseDto } from './dto/receipt-response.dto.js';
import { ReceiptPrintDto } from './dto/receipt-print.dto.js';
import { ListReceiptsQueryDto } from './dto/list-receipts-query.dto.js';

@ApiTags('Financial — Receipts')
@ApiBearerAuth()
@Controller('organizations/:orgId/receipts')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get()
  @ApiStandardResponse(ReceiptResponseDto)
  list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ListReceiptsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.receiptsService.listForInvoice(orgId, query.invoice_id, user);
  }

  @Get(':id')
  @ApiStandardResponse(ReceiptResponseDto)
  getReceipt(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.receiptsService.getReceipt(orgId, id, user);
  }

  @Get(':id/print')
  @ApiStandardResponse(ReceiptPrintDto)
  print(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.receiptsService.print(orgId, id, user);
  }
}
