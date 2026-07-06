import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { PatientExportService } from './patient-export.service.js';
import { PatientExportDto } from './dto/patient-export.dto.js';

/**
 * Data-subject-access / portability. OWNER-only export of a patient's record,
 * scoped to the caller's organization (the controller fulfilling a DSAR).
 */
@ApiTags('Compliance — Data Subject Requests')
@Controller()
export class DsarController {
  constructor(private readonly exportService: PatientExportService) {}

  @Post('/patients/:patientId/export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Export a patient's record for a data-subject-access request",
  })
  @ApiStandardResponse(PatientExportDto)
  export(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.exportService.exportPatient(patientId, user);
  }
}
