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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
} from '@common/swagger/index.js';
import { PermissionGuard } from '@common/guards/permission.guard.js';
import { RequirePermission } from '@common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '@common/authorization/permission-matrix.js';
import { CashManagementService } from './cash-management.service.js';
import { OpenCashSessionDto } from './dto/open-cash-session.dto.js';
import { CloseCashSessionDto } from './dto/close-cash-session.dto.js';
import { ListCashSessionsQueryDto } from './dto/list-cash-sessions-query.dto.js';
import { CurrentCashSessionQueryDto } from './dto/current-cash-session-query.dto.js';
import { CashSessionResponseDto } from './dto/cash-session-response.dto.js';

@ApiTags('Financial — Cash Management')
@ApiBearerAuth()
@Controller('organizations/:orgId/financial/cash-sessions')
// Coarse cash gate on mutations only (owner / branch-manager / receptionist /
// accountant); GET reads stay open. The finer rules — branch scoping, and
// accountant/manager-only reconcile (segregation of duties) — stay in the
// service layer.
@UseGuards(PermissionGuard)
export class CashManagementController {
  constructor(private readonly cashManagementService: CashManagementService) {}

  @Post()
  @RequirePermission(PERMISSIONS.financialManageCash)
  @HttpCode(HttpStatus.CREATED)
  @ApiStandardResponse(CashSessionResponseDto)
  open(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: OpenCashSessionDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.cashManagementService.open(orgId, dto, user);
  }

  @Get()
  @ApiPaginatedResponse(CashSessionResponseDto)
  list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ListCashSessionsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.cashManagementService.list(
      orgId,
      { branchId: query.branch_id, status: query.status },
      query.page ?? 1,
      query.limit ?? 20,
      user,
    );
  }

  @Get('current')
  @ApiStandardResponse(CashSessionResponseDto)
  current(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: CurrentCashSessionQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.cashManagementService.current(orgId, query.branch_id, user);
  }

  @Get(':id')
  @ApiStandardResponse(CashSessionResponseDto)
  getOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.cashManagementService.getOne(orgId, id, user);
  }

  @Post(':id/close')
  @RequirePermission(PERMISSIONS.financialManageCash)
  @ApiStandardResponse(CashSessionResponseDto)
  close(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseCashSessionDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.cashManagementService.close(orgId, id, dto, user);
  }

  @Post(':id/reconcile')
  @RequirePermission(PERMISSIONS.financialManageCash)
  @ApiStandardResponse(CashSessionResponseDto)
  reconcile(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.cashManagementService.reconcile(orgId, id, user);
  }
}
