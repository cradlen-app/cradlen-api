import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator';
import { CurrentPatient } from '@common/decorators/current-patient.decorator';
import { AuditsPhiAccess } from '@common/decorators/audits-phi-access.decorator';
import { PatientJwtAuthGuard } from '@common/guards/patient-jwt-auth.guard';
import { ApiStandardResponse } from '@common/swagger';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface';
import { ObgynPortalHistoryService } from './obgyn-portal-history.service';
import { PortalHistoryResponseDto } from './dto/portal-history.dto';
import { ListPortalHistoryQueryDto } from './dto/list-portal-history.query.dto';

/**
 * Patient-portal OB/GYN history (read-only). Mounted under the `patient-portal`
 * route prefix alongside the core portal endpoints (medications, visits) and
 * authenticated by the same `patient-jwt` strategy.
 */
@ApiTags('Patient Portal')
@Controller({ path: 'patient-portal', version: '1' })
export class ObgynPortalHistoryController {
  constructor(private readonly service: ObgynPortalHistoryService) {}

  @Get('obgyn-history')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Read the patient's OB/GYN history as display-ready sections",
  })
  @AuditsPhiAccess({
    resource: 'portal.obgyn_history',
    purpose: 'patient_self',
    subject: 'self',
  })
  @ApiStandardResponse(PortalHistoryResponseDto)
  getObgynHistory(
    @CurrentPatient() patient: PatientAuthContext,
    @Query() query: ListPortalHistoryQueryDto,
  ): Promise<PortalHistoryResponseDto> {
    return this.service.getHistory(patient, query.patient_id);
  }
}
