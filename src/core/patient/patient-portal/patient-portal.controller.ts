import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { PatientInvestigationResultsService } from './patient-investigation-results.service.js';
import { PatientMedicationsResponseDto } from './dto/patient-medication.dto.js';
import { ListPatientMedicationsQueryDto } from './dto/list-patient-medications.query.dto.js';
import { PatientVisitItemDto } from './dto/patient-visit.dto.js';
import { PatientUpcomingVisitItemDto } from './dto/patient-upcoming-visit.dto.js';
import { ListPatientVisitsQueryDto } from './dto/list-patient-visits.query.dto.js';
import { PatientInvestigationItemDto } from './dto/patient-investigation.dto.js';
import { ListPatientInvestigationsQueryDto } from './dto/list-patient-investigations.query.dto.js';
import {
  ConfirmResultDto,
  CreateResultUploadDto,
  ResultUploadUrlDto,
} from './dto/investigation-result.dto.js';

@ApiTags('Patient Portal')
@Controller({ path: 'patient-portal', version: '1' })
export class PatientPortalController {
  constructor(
    private readonly medicationsService: PatientMedicationsService,
    private readonly visitsService: PatientVisitsService,
    private readonly investigationsService: PatientInvestigationsService,
    private readonly investigationResultsService: PatientInvestigationResultsService,
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

  @Get('visits/upcoming')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "List the patient's upcoming recommended follow-ups (paginated)",
  })
  @ApiPaginatedResponse(PatientUpcomingVisitItemDto)
  upcoming(
    @CurrentPatient() patient: PatientAuthContext,
    @Query() query: ListPatientVisitsQueryDto,
  ) {
    return this.visitsService.listUpcoming(patient, query);
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

  @Post('investigations/:investigationId/result-upload-url')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a presigned URL to upload a result file for an investigation',
  })
  @ApiStandardResponse(ResultUploadUrlDto)
  resultUploadUrl(
    @CurrentPatient() patient: PatientAuthContext,
    @Param('investigationId', ParseUUIDPipe) investigationId: string,
    @Body() dto: CreateResultUploadDto,
  ) {
    return this.investigationResultsService.createUploadUrl(
      patient,
      investigationId,
      dto,
    );
  }

  @Post('investigations/:investigationId/result')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Confirm an uploaded result file and record it on the investigation',
  })
  @ApiStandardResponse(PatientInvestigationItemDto)
  confirmResult(
    @CurrentPatient() patient: PatientAuthContext,
    @Param('investigationId', ParseUUIDPipe) investigationId: string,
    @Body() dto: ConfirmResultDto,
  ) {
    return this.investigationResultsService.confirmResult(
      patient,
      investigationId,
      dto,
    );
  }

  @Delete('investigations/:investigationId/result/:attachmentId')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Remove a result file the patient uploaded (before review)',
  })
  @ApiStandardResponse(PatientInvestigationItemDto)
  removeResultAttachment(
    @CurrentPatient() patient: PatientAuthContext,
    @Param('investigationId', ParseUUIDPipe) investigationId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.investigationResultsService.removeAttachment(
      patient,
      investigationId,
      attachmentId,
    );
  }
}
