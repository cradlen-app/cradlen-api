import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { AdminJwtAuthGuard } from '@common/guards/admin-jwt-auth.guard.js';
import { ApiPaginatedResponse } from '@common/swagger/index.js';
import { AdminListQueryDto } from '../read/dto/admin-list-query.dto.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminAuditLogResponseDto } from './dto/admin-audit-log-response.dto.js';

@ApiTags('Platform Admin')
@ApiBearerAuth()
@Public()
@UseGuards(AdminJwtAuthGuard)
@Controller({ path: 'admin/audit-log', version: '1' })
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  @ApiOperation({ summary: 'List platform-admin audit-log entries' })
  @ApiPaginatedResponse(AdminAuditLogResponseDto)
  list(@Query() query: AdminListQueryDto) {
    return this.audit.list(query);
  }
}
