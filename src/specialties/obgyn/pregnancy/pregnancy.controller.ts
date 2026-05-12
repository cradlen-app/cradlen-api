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
  AmnioticPlacentaDto,
  BiometricsDto,
  CervixDto,
  FetalLieDto,
  FundalDto,
  PregnancyEpisodeRecordDto,
  PregnancyEpisodeUpdateDto,
  PregnancyJourneyRecordDto,
  PregnancySnapshotDto,
  VisitPregnancyRecordDto,
  WarningSymptomsDto,
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

  // ---------- Journey snapshot ----------

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

  // ---------- Visit-level per-ANC measurements ----------

  @Get('visits/:visitId/pregnancy-record')
  @ApiStandardResponse(VisitPregnancyRecordDto)
  getVisitRecord(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.getVisitRecord(visitId, user);
  }

  @Patch('visits/:visitId/pregnancy-record/cervix')
  @LocksOnClosedVisit('visitId')
  @ApiHeader(IF_MATCH)
  patchCervix(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: CervixDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchVisitRecord(
      visitId,
      'cervix',
      dto as unknown as Record<string, unknown>,
      version,
      user,
    );
  }

  @Patch('visits/:visitId/pregnancy-record/warning-symptoms')
  @LocksOnClosedVisit('visitId')
  @ApiHeader(IF_MATCH)
  patchWarningSymptoms(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: WarningSymptomsDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchVisitRecord(
      visitId,
      'warning-symptoms',
      dto as unknown as Record<string, unknown>,
      version,
      user,
    );
  }

  @Patch('visits/:visitId/pregnancy-record/fundal')
  @LocksOnClosedVisit('visitId')
  @ApiHeader(IF_MATCH)
  patchFundal(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: FundalDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchVisitRecord(
      visitId,
      'fundal',
      dto as unknown as Record<string, unknown>,
      version,
      user,
    );
  }

  @Patch('visits/:visitId/pregnancy-record/amniotic-placenta')
  @LocksOnClosedVisit('visitId')
  @ApiHeader(IF_MATCH)
  patchAmnioticPlacenta(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: AmnioticPlacentaDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchVisitRecord(
      visitId,
      'amniotic-placenta',
      dto as unknown as Record<string, unknown>,
      version,
      user,
    );
  }

  @Patch('visits/:visitId/pregnancy-record/fetal-lie')
  @LocksOnClosedVisit('visitId')
  @ApiHeader(IF_MATCH)
  patchFetalLie(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: FetalLieDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchVisitRecord(
      visitId,
      'fetal-lie',
      dto as unknown as Record<string, unknown>,
      version,
      user,
    );
  }

  @Patch('visits/:visitId/pregnancy-record/biometrics')
  @LocksOnClosedVisit('visitId')
  @ApiHeader(IF_MATCH)
  patchBiometrics(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: BiometricsDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchVisitRecord(
      visitId,
      'biometrics',
      dto as unknown as Record<string, unknown>,
      version,
      user,
    );
  }
}
