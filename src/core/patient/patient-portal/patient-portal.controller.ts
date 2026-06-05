import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { CurrentPatient } from '@common/decorators/current-patient.decorator.js';
import { PatientJwtAuthGuard } from '@common/guards/patient-jwt-auth.guard.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
} from '@common/swagger/index.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientMedicationsService } from './patient-medications.service.js';
import { PatientVisitsService } from './patient-visits.service.js';
import { PatientInvestigationsService } from './patient-investigations.service.js';
import { PatientMedicationsResponseDto } from './dto/patient-medication.dto.js';
import { ListPatientMedicationsQueryDto } from './dto/list-patient-medications.query.dto.js';
import { PatientVisitItemDto } from './dto/patient-visit.dto.js';
import { ListPatientVisitsQueryDto } from './dto/list-patient-visits.query.dto.js';
import { PatientInvestigationItemDto } from './dto/patient-investigation.dto.js';
import { ListPatientInvestigationsQueryDto } from './dto/list-patient-investigations.query.dto.js';

@ApiTags('Patient Portal')
@Controller({ path: 'patient-portal', version: '1' })
export class PatientPortalController {
  constructor(
    private readonly medicationsService: PatientMedicationsService,
    private readonly visitsService: PatientVisitsService,
    private readonly investigationsService: PatientInvestigationsService,
  ) {}

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

  @Get('visits')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "List the patient's completed visit history (paginated)",
  })
  @ApiPaginatedResponse(PatientVisitItemDto)
  visits(
    @CurrentPatient() patient: PatientAuthContext,
    @Query() query: ListPatientVisitsQueryDto,
  ) {
    return this.visitsService.listVisits(patient, query);
  }

  @Get('investigations')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "List the patient's investigations (lab tests & imaging)",
  })
  @ApiPaginatedResponse(PatientInvestigationItemDto)
  investigations(
    @CurrentPatient() patient: PatientAuthContext,
    @Query() query: ListPatientInvestigationsQueryDto,
  ) {
    return this.investigationsService.listInvestigations(patient, query);
  }
}
