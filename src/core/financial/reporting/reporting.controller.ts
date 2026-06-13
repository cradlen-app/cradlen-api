import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import { ReportingService } from './reporting.service.js';
import { ReportQueryDto } from './dto/report-query.dto.js';
import { DailyRevenueReportDto } from './dto/daily-revenue.dto.js';
import { RevenueByServiceReportDto } from './dto/revenue-by-service.dto.js';
import { RevenueByDoctorReportDto } from './dto/revenue-by-doctor.dto.js';
import { RevenueByBranchReportDto } from './dto/revenue-by-branch.dto.js';
import { OutstandingInvoicesReportDto } from './dto/outstanding-invoices.dto.js';
import { PaymentsByMethodReportDto } from './dto/payments-by-method.dto.js';
import { InvoiceStatsReportDto } from './dto/invoice-stats.dto.js';

@ApiTags('Financial — Reports')
@ApiBearerAuth()
@Controller('organizations/:orgId/financial/reports')
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('revenue')
  @ApiStandardResponse(Object)
  revenue(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.reportingService.revenueSummary(orgId, this.scope(query), user);
  }

  @Get('invoice-stats')
  @ApiStandardResponse(InvoiceStatsReportDto)
  invoiceStats(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.reportingService.invoiceStats(orgId, this.scope(query), user);
  }

  @Get('ar-aging')
  @ApiStandardResponse(Object)
  arAging(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.reportingService.arAging(orgId, this.scope(query), user);
  }

  @Get('collections')
  @ApiStandardResponse(Object)
  collections(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.reportingService.collections(orgId, this.scope(query), user);
  }

  @Get('write-offs')
  @ApiStandardResponse(Object)
  writeOffs(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.reportingService.writeOffs(orgId, this.scope(query), user);
  }

  @Get('daily-revenue')
  @ApiStandardResponse(DailyRevenueReportDto)
  dailyRevenue(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.reportingService.dailyRevenue(orgId, this.scope(query), user);
  }

  @Get('revenue-by-service')
  @ApiStandardResponse(RevenueByServiceReportDto)
  revenueByService(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.reportingService.revenueByService(
      orgId,
      this.scope(query),
      user,
    );
  }

  @Get('revenue-by-doctor')
  @ApiStandardResponse(RevenueByDoctorReportDto)
  revenueByDoctor(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.reportingService.revenueByDoctor(
      orgId,
      this.scope(query),
      user,
    );
  }

  @Get('revenue-by-branch')
  @ApiStandardResponse(RevenueByBranchReportDto)
  revenueByBranch(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.reportingService.revenueByBranch(
      orgId,
      this.scope(query),
      user,
    );
  }

  @Get('outstanding-invoices')
  @ApiStandardResponse(OutstandingInvoicesReportDto)
  outstandingInvoices(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.reportingService.outstandingInvoices(
      orgId,
      this.scope(query),
      user,
    );
  }

  @Get('payments-by-method')
  @ApiStandardResponse(PaymentsByMethodReportDto)
  paymentsByMethod(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.reportingService.paymentsByMethod(
      orgId,
      this.scope(query),
      user,
    );
  }

  private scope(query: ReportQueryDto) {
    return {
      branchId: query.branch_id,
      dateFrom: query.date_from,
      dateTo: query.date_to,
    };
  }
}
