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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '@common/swagger/index.js';
import { InvoicesService } from './invoices.service.js';
import { CreateInvoiceDto, InvoiceItemInputDto } from './dto/create-invoice.dto.js';
import { UpdateInvoiceDto } from './dto/update-invoice.dto.js';
import { RecordPaymentDto } from './dto/record-payment.dto.js';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto.js';

@ApiTags('Financial — Invoices')
@ApiBearerAuth()
@Controller('organizations/:orgId/invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @ApiPaginatedResponse(Object)
  findAll(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ListInvoicesQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicesService.findAll(
      orgId,
      {
        status: query.status,
        patientId: query.patient_id,
        branchId: query.branch_id,
        invoiceType: query.type,
        dateFrom: query.date_from,
        dateTo: query.date_to,
      },
      query.page ?? 1,
      query.limit ?? 20,
      user,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiStandardResponse(Object)
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicesService.create(orgId, dto, user);
  }

  @Get(':id')
  @ApiStandardResponse(Object)
  async findOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    await this.invoicesService.assertViewAccess(user, orgId);
    return this.invoicesService.findOne(orgId, id);
  }

  @Patch(':id')
  @ApiStandardResponse(Object)
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicesService.update(orgId, id, dto, user);
  }

  @Post(':id/items')
  @HttpCode(HttpStatus.CREATED)
  @ApiStandardResponse(Object)
  addItem(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InvoiceItemInputDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicesService.addItem(orgId, id, dto, user);
  }

  @Delete(':id/items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  removeItem(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicesService.removeItem(orgId, id, itemId, user);
  }

  @Post(':id/issue')
  @ApiStandardResponse(Object)
  issue(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicesService.issue(orgId, id, user);
  }

  @Post(':id/void')
  @ApiStandardResponse(Object)
  void(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicesService.void(orgId, id, user);
  }

  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @ApiStandardResponse(Object)
  recordPayment(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.invoicesService.recordPayment(orgId, id, dto, user);
  }

  @Get(':id/payments')
  @ApiStandardResponse(Object)
  async findPayments(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    await this.invoicesService.assertViewAccess(user, orgId);
    return this.invoicesService.findPayments(orgId, id);
  }
}
