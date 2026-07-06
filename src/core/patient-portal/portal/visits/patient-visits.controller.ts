import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { CurrentPatient } from '@common/decorators/current-patient.decorator.js';
import { AuditsPhiAccess } from '@common/decorators/audits-phi-access.decorator.js';
import { PatientJwtAuthGuard } from '@common/guards/patient-jwt-auth.guard.js';
import { ApiPaginatedResponse } from '@common/swagger/index.js';
import type { PatientAuthContext } from '@common/interfaces/patient-auth-context.interface.js';
import { PatientVisitsService } from './patient-visits.service.js';
import { PatientVisitItemDto } from './dto/patient-visit.dto.js';
import { PatientUpcomingVisitItemDto } from './dto/patient-upcoming-visit.dto.js';
import { PatientJourneyTimelineDto } from './dto/patient-journey-timeline.dto.js';
import { ListPatientVisitsQueryDto } from './dto/list-patient-visits.query.dto.js';

@ApiTags('Patient Portal')
@Controller({ path: 'patient-portal/visits', version: '1' })
export class PatientVisitsController {
  constructor(private readonly visitsService: PatientVisitsService) {}

  @Get()
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "List the patient's completed visit history (paginated)",
  })
  @ApiPaginatedResponse(PatientVisitItemDto)
  @AuditsPhiAccess({
    resource: 'portal.visits',
    purpose: 'patient_self',
    subject: 'self',
  })
  visits(
    @CurrentPatient() patient: PatientAuthContext,
    @Query() query: ListPatientVisitsQueryDto,
  ) {
    return this.visitsService.listVisits(patient, query);
  }

  @Get('upcoming')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "List the patient's upcoming recommended follow-ups (paginated)",
  })
  @ApiPaginatedResponse(PatientUpcomingVisitItemDto)
  @AuditsPhiAccess({
    resource: 'portal.visits.upcoming',
    purpose: 'patient_self',
    subject: 'self',
  })
  upcoming(
    @CurrentPatient() patient: PatientAuthContext,
    @Query() query: ListPatientVisitsQueryDto,
  ) {
    return this.visitsService.listUpcoming(patient, query);
  }

  @Get('journeys/timeline')
  @Public()
  @UseGuards(PatientJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Patient journey timeline: journeys → episodes → completed visits (paginated by journey)',
  })
  @ApiPaginatedResponse(PatientJourneyTimelineDto)
  @AuditsPhiAccess({
    resource: 'portal.journeys.timeline',
    purpose: 'patient_self',
    subject: 'self',
  })
  journeyTimeline(
    @CurrentPatient() patient: PatientAuthContext,
    @Query() query: ListPatientVisitsQueryDto,
  ) {
    return this.visitsService.listJourneyTimeline(patient, query);
  }
}
