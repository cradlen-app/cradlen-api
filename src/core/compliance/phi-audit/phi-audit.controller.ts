import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { AuthorizationService } from '@core/auth/authorization/authorization.service.js';
import { PatientAccessService } from '@core/patient/patient-access/patient-access.public.js';
import { PhiAuditService } from './phi-audit.service.js';
import { PhiAccessLogQueryDto } from './dto/phi-access-log-query.dto.js';
import { PhiAccessLogEntryDto } from './dto/phi-access-log-entry.dto.js';

/**
 * Controller-facing "who accessed this patient" report over the PHI read-access
 * trail. OWNER-only and scoped to a patient enrolled in the caller's org — the
 * compliance surface a clinic uses to answer a patient's access-disclosure
 * request (HIPAA / GDPR / PDPL accountability).
 */
@ApiTags('Compliance — PHI Access Log')
@Controller()
export class PhiAuditController {
  constructor(
    private readonly phiAuditService: PhiAuditService,
    private readonly authorizationService: AuthorizationService,
    private readonly patientAccessService: PatientAccessService,
  ) {}

  @Get('/patients/:patientId/access-log')
  @ApiOperation({
    summary: 'PHI read-access history for a patient (OWNER-only)',
  })
  @ApiPaginatedResponse(PhiAccessLogEntryDto)
  async listForPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: PhiAccessLogQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    await this.authorizationService.assertCanManageOrganization(
      user.profileId,
      user.organizationId,
    );
    await this.patientAccessService.assertPatientInOrg(patientId, user);
    return this.phiAuditService.list({
      patientId,
      page: query.page,
      limit: query.limit,
    });
  }
}
