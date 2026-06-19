import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import { PermissionGuard } from '@common/guards/permission.guard.js';
import { RequirePermission } from '@common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '@common/authorization/permission-matrix.js';
import { ReceiptsService } from './receipts.service.js';
import { ReceiptResponseDto } from './dto/receipt-response.dto.js';
import { ReceiptPrintDto } from './dto/receipt-print.dto.js';
import { ListReceiptsQueryDto } from './dto/list-receipts-query.dto.js';

@ApiTags('Financial — Receipts')
@ApiBearerAuth()
@Controller('organizations/:orgId/receipts')
// Coarse billing-surface gate (owner / branch-manager / receptionist /
// accountant). Branch scoping stays in the service layer.
@UseGuards(PermissionGuard)
@RequirePermission(PERMISSIONS.financialRead)
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
