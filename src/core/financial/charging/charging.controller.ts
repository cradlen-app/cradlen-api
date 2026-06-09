import {
  Body,
  Controller,
  Get,
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
} from '@common/swagger/index.js';
import { ChargingService } from './charging.service.js';
import { CaptureChargeDto } from './dto/capture-charge.dto.js';
import { UpdateChargeDto } from './dto/update-charge.dto.js';
import { ListChargesQueryDto } from './dto/list-charges-query.dto.js';
import { ChargeResponseDto } from './dto/charge-response.dto.js';

@ApiTags('Financial — Charges')
@ApiBearerAuth()
@Controller('organizations/:orgId/financial/charges')
export class ChargingController {
  constructor(private readonly chargingService: ChargingService) {}

  @Post()
  @ApiStandardResponse(ChargeResponseDto)
  capture(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CaptureChargeDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.chargingService.capture(orgId, dto, user);
  }

  @Get()
  @ApiPaginatedResponse(ChargeResponseDto)
  list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: ListChargesQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.chargingService.list(
      orgId,
      {
        patient_id: query.patient_id,
        visit_id: query.visit_id,
        branch_id: query.branch_id,
        status: query.status,
      },
      query.page ?? 1,
      query.limit ?? 20,
      user,
    );
  }

  @Get('visit/:visitId')
  @ApiStandardResponse(Object)
  getByVisit(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.chargingService.getByVisit(orgId, visitId, user);
  }

  @Patch(':id')
  @ApiStandardResponse(ChargeResponseDto)
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChargeDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.chargingService.update(orgId, id, dto, user);
  }

  @Post(':id/cancel')
  @ApiStandardResponse(ChargeResponseDto)
  cancel(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.chargingService.cancel(orgId, id, user);
  }

  @Post(':id/void')
  @ApiStandardResponse(ChargeResponseDto)
  void(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.chargingService.void(orgId, id, user);
  }

  @Post(':id/write-off')
  @ApiStandardResponse(ChargeResponseDto)
  writeOff(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.chargingService.writeOff(orgId, id, user);
  }
}
