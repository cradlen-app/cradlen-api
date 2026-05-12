import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger';
import {
  CurrentUser,
  IfMatchVersion,
  LocksOnClosedVisit,
} from '@common/decorators';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { EncounterMutationGuard } from '@core/clinical/visits/visits.public';
import { PregnancyService } from './pregnancy.service';
import {
  PregnancyEpisodeRecordDto,
  PregnancyEpisodeUpdateDto,
  PregnancyJourneyRecordDto,
  PregnancySnapshotDto,
  UpdateVisitPregnancyRecordDto,
  VisitPregnancyRecordDto,
} from './dto/pregnancy.dto';

const IF_MATCH = {
  name: 'If-Match',
  required: true,
  description:
    'Optimistic concurrency token. Echo the row\'s current `version` as `"version:N"`.',
};

@ApiTags('OB/GYN — Pregnancy')
@Controller()
@UseGuards(EncounterMutationGuard)
export class PregnancyController {
  constructor(private readonly service: PregnancyService) {}

  // ---------- Journey-level snapshot (single row, single bulk PATCH) ----------

  @Get('journeys/:journeyId/pregnancy-record')
  @ApiStandardResponse(PregnancyJourneyRecordDto)
  getJourneyRecord(
    @Param('journeyId', ParseUUIDPipe) journeyId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.getJourneyRecord(journeyId, user);
  }

  @Patch('journeys/:journeyId/pregnancy-record')
  @ApiHeader(IF_MATCH)
  patchJourneyRecord(
    @Param('journeyId', ParseUUIDPipe) journeyId: string,
    @Body() dto: PregnancySnapshotDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchJourneyRecord(
      journeyId,
      dto as unknown as Record<string, unknown>,
      version,
      user,
    );
  }

  // ---------- Episode-level trimester milestones ----------

  @Get('episodes/:episodeId/pregnancy-record')
  @ApiStandardResponse(PregnancyEpisodeRecordDto)
  getEpisodeRecord(
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.getEpisodeRecord(episodeId, user);
  }

  @Patch('episodes/:episodeId/pregnancy-record')
  @ApiHeader(IF_MATCH)
  patchEpisodeRecord(
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
    @Body() dto: PregnancyEpisodeUpdateDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchEpisodeRecord(episodeId, dto, version, user);
  }

  // ---------- Visit-level per-ANC measurements (single bulk PATCH) ----------

  @Get('visits/:visitId/pregnancy-record')
  @ApiStandardResponse(VisitPregnancyRecordDto)
  getVisitRecord(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.getVisitRecord(visitId, user);
  }

  @Patch('visits/:visitId/pregnancy-record')
  @LocksOnClosedVisit('visitId')
  @ApiHeader(IF_MATCH)
  patchVisitRecord(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: UpdateVisitPregnancyRecordDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchVisitRecord(
      visitId,
      dto as unknown as Record<string, unknown>,
      version,
      user,
    );
  }
}
