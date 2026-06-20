import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '@common/swagger/index.js';
import { PermissionGuard } from '@common/guards/permission.guard.js';
import { RequirePermission } from '@common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '@common/authorization/permission-matrix.js';
import { InvoicingService } from './invoicing.service.js';
import {
  CreateInvoiceDto,
  InvoiceItemInputDto,
} from './dto/create-invoice.dto.js';
import { UpdateInvoiceDto } from './dto/update-invoice.dto.js';
import { BuildInvoiceFromChargesDto } from './dto/build-invoice-from-charges.dto.js';
import { AppendChargesDto } from './dto/append-charges.dto.js';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto.js';
import { InvoiceResponseDto } from './dto/invoice-response.dto.js';

@ApiTags('Financial — Invoices')
@ApiBearerAuth()
@Controller('organizations/:orgId/invoices')
// Coarse billing-surface gate on mutations only (owner / branch-manager /
// receptionist / accountant), matching the frontend Financial nav. GET reads
// stay open to any branch staff (e.g. a clinician viewing a patient's balance).
// Branch scoping and the per-action `assertCanRunBillingAction` checks stay in
// the service layer.
@UseGuards(PermissionGuard)
export class InvoicingController {
  constructor(private readonly invoicingService: InvoicingService) {}

  @Get()
  @ApiPaginatedResponse(InvoiceResponseDto)
  findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ListInvoicesQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicingService.findAll(
      orgId,
      {
        status: query.status,
        patientId: query.patient_id,
        branchId: query.branch_id,
        visitIds: query.visit_ids,
        invoiceType: query.type,
        dateFrom: query.date_from,
        dateTo: query.date_to,
        search: query.search,
      },
      query.page ?? 1,
      query.limit ?? 20,
      user,
    );
  }

  @Post()
  @RequirePermission(PERMISSIONS.financialRead)
  @HttpCode(HttpStatus.CREATED)
  @ApiStandardResponse(InvoiceResponseDto)
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicingService.create(orgId, dto, user);
  }

  @Post('from-charges')
  @RequirePermission(PERMISSIONS.financialRead)
  @HttpCode(HttpStatus.CREATED)
  @ApiStandardResponse(InvoiceResponseDto)
  buildFromCharges(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: BuildInvoiceFromChargesDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicingService.buildFromCharges(orgId, dto, user);
  }

  @Post(':id/append-charges')
  @RequirePermission(PERMISSIONS.financialRead)
  @HttpCode(HttpStatus.CREATED)
  @ApiStandardResponse(InvoiceResponseDto)
  appendCharges(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AppendChargesDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicingService.appendCharges(orgId, id, dto, user);
  }

  @Get(':id')
  @ApiStandardResponse(InvoiceResponseDto)
  findOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicingService.findOne(orgId, id, user);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.financialRead)
  @ApiStandardResponse(InvoiceResponseDto)
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicingService.update(orgId, id, dto, user);
  }

  @Post(':id/items')
  @RequirePermission(PERMISSIONS.financialRead)
  @HttpCode(HttpStatus.CREATED)
  @ApiStandardResponse(InvoiceResponseDto)
  addItem(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InvoiceItemInputDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicingService.addItem(orgId, id, dto, user);
  }

  @Delete(':id/items/:itemId')
  @RequirePermission(PERMISSIONS.financialRead)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  removeItem(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicingService.removeItem(orgId, id, itemId, user);
  }

  @Post(':id/issue')
  @RequirePermission(PERMISSIONS.financialRead)
  @ApiStandardResponse(InvoiceResponseDto)
  issue(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicingService.issue(orgId, id, user);
  }

  @Post(':id/void')
  @RequirePermission(PERMISSIONS.financialRead)
  @ApiStandardResponse(InvoiceResponseDto)
  void(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicingService.void(orgId, id, user);
  }
}
