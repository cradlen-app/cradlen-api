import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { CurrentPatient } from '@common/decorators/current-patient.decorator.js';
import { PatientJwtAuthGuard } from '@common/guards/patient-jwt-auth.guard.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientMedicationsService } from './patient-medications.service.js';
import { PatientMedicationsResponseDto } from './dto/patient-medication.dto.js';
import { ListPatientMedicationsQueryDto } from './dto/list-patient-medications.query.dto.js';

@ApiTags('Patient Portal')
@Controller({ path: 'patient-portal', version: '1' })
export class PatientPortalController {
  constructor(private readonly medicationsService: PatientMedicationsService) {}

  @Get('medications')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "List the patient's prescribed medications (current + past)",
  })
  @ApiStandardResponse(PatientMedicationsResponseDto)
  medications(
    @CurrentPatient() patient: PatientAuthContext,
    @Query() query: ListPatientMedicationsQueryDto,
  ) {
    return this.medicationsService.listMedications(patient, query.patient_id);
  }
}
