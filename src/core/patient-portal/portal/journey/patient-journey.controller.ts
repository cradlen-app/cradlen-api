import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { CurrentPatient } from '@common/decorators/current-patient.decorator.js';
import { PatientJwtAuthGuard } from '@common/guards/patient-jwt-auth.guard.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientJourneyService } from './patient-journey.service.js';
import { PatientJourneyDto } from './dto/patient-journey.dto.js';
import { GetPatientJourneyQueryDto } from './dto/get-patient-journey.query.dto.js';

@ApiTags('Patient Portal')
@Controller({ path: 'patient-portal/journey', version: '1' })
export class PatientJourneyController {
  constructor(private readonly journeyService: PatientJourneyService) {}

  @Get()
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get the patient's active journey for the home dashboard",
    description:
      'Care-path type, ordered stages (DONE/CURRENT/UPCOMING), and an optional ' +
      'pregnancy block (GA + EDD). Null when the patient has no active journey.',
  })
  @ApiOkResponse({ type: PatientJourneyDto })
  journey(
    @CurrentPatient() patient: PatientAuthContext,
    @Query() query: GetPatientJourneyQueryDto,
  ) {
    return this.journeyService.getActiveJourney(patient, query);
  }
}
