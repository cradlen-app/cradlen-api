import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { VisitStatus } from '@prisma/client';
import { VisitsService } from './visits.service';
import { VisitStatusService } from './visit-status.service';
import { BookVisitDto } from './dto/book-visit.dto';
import { UpdateVisitDto } from './dto/update-visit.dto';
import { UpdateVisitStatusDto } from './dto/update-visit-status.dto';
import { SetFollowUpDto } from './dto/set-follow-up.dto';
import { VisitDto } from './dto/visit.dto';
import { VisitHistorySummaryDto } from './dto/visit-history-summary.dto';
import { VitalsTrendPointDto } from './dto/vitals-trend-point.dto';
import {
  ListVisitsQueryDto,
  ListBranchVisitsQueryDto,
  VisitHistoryQueryDto,
  VitalsTrendQueryDto,
} from './dto/list-visits-query.dto';
import {
  ApiStandardResponse,
  ApiStandardArrayResponse,
  ApiPaginatedResponse,
} from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

@ApiTags('Visits')
@Controller()
export class VisitsController {
  constructor(
    private readonly visitsService: VisitsService,
    private readonly visitStatusService: VisitStatusService,
  ) {}

  @Get('episodes/:episodeId/visits')
  @ApiPaginatedResponse(VisitDto)
  findAll(
    @Param('episodeId') episodeId: string,
    @Query() query: ListVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.findAllForEpisode(episodeId, user, query);
  }

  @Post('visits/book')
  @ApiStandardResponse(VisitDto)
  bookVisit(@Body() dto: BookVisitDto, @CurrentUser() user: AuthContext) {
    return this.visitsService.bookVisit(dto, user);
  }

  @Get('branches/:branchId/visits/my-waiting-list')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Today's SCHEDULED + CHECKED_IN visits assigned to the current doctor at this branch",
  })
  @ApiPaginatedResponse(VisitDto)
  findMyWaitingList(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.findMyWaitingList(branchId, query, user);
  }

  @Get('branches/:branchId/visits/my-current')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "The doctor's live visits at this branch today — queued (IN_PROGRESS) and in consultation (IN_CONSULTATION)",
  })
  @ApiStandardArrayResponse(VisitDto)
  findMyCurrent(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.findMyCurrent(branchId, user);
  }

  @Get('visits/:id')
  @ApiStandardResponse(VisitDto)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return this.visitsService.findOne(id, user);
  }

  @Get('patients/:patientId/visits/history')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Paginated completed visit history for a patient' })
  @ApiPaginatedResponse(VisitHistorySummaryDto)
  findPatientVisitHistory(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: VisitHistoryQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.findPatientVisitHistory(
      patientId,
      user.organizationId,
      { page: query.page, limit: query.limit, excludeVisitId: query.exclude },
    );
  }

  @Get('patients/:patientId/vitals-trend')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Full vitals trend series for BP and Weight/BMI charts',
  })
  @ApiStandardResponse(VitalsTrendPointDto)
  findPatientVitalsTrend(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: VitalsTrendQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.findPatientVitalsTrend(
      patientId,
      user.organizationId,
      query.exclude,
    );
  }

  @Patch('visits/:id')
  @ApiStandardResponse(VisitDto)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateVisitDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.update(id, dto, user);
  }

  @Patch('visits/:id/status')
  @ApiStandardResponse(VisitDto)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateVisitStatusDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitStatusService.updateStatus(id, dto, user);
  }

  @Put('visits/:id/follow-up')
  @ApiStandardResponse(VisitDto)
  setFollowUp(
    @Param('id') id: string,
    @Body() dto: SetFollowUpDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitStatusService.setFollowUp(id, dto, user);
  }

  @Get('branches/:branchId/visits/waiting-list')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Today's SCHEDULED + CHECKED_IN visits for a branch",
  })
  @ApiPaginatedResponse(VisitDto)
  findBranchWaitingList(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.findBranchWaitingList(branchId, query, user);
  }

  @Get('branches/:branchId/visits/in-progress')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Today's live visits for a branch — queued (IN_PROGRESS) and in consultation (IN_CONSULTATION)",
  })
  @ApiPaginatedResponse(VisitDto)
  findBranchInProgress(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.findBranchInProgress(branchId, query, user);
  }

  @Get('branches/:branchId/visits')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Today's visits for a branch filtered by status",
  })
  @ApiQuery({ name: 'status', enum: VisitStatus, required: true })
  @ApiPaginatedResponse(VisitDto)
  findAllForBranch(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListBranchVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.findAllForBranch(
      branchId,
      query.status,
      { page: query.page, limit: query.limit },
      user,
    );
  }
}
