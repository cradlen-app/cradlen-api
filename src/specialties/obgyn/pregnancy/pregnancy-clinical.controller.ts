import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger';
import { CurrentUser, LocksOnClosedVisit } from '@common/decorators';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { EncounterMutationGuard } from '@core/clinical/visits/visits.public';
import { PregnancyClinicalService } from './pregnancy-clinical.service';
import {
  PregnancyClinicalEnvelopeDto,
  UpdatePregnancyClinicalDto,
} from './dto/pregnancy-clinical.dto';

/**
 * Pregnancy journey clinical surface — the active-journey tab for the
 * `OBGYN_PREGNANCY` care path. GET/PATCH a flat envelope; PATCH carries an
 * `If-Match: version:N` precondition on the `PregnancyJourneyRecord.version`
 * token (independent of `examination_version`). Closed visits are blocked by
 * `EncounterMutationGuard` — post-close edits go via amendments.
 */
@ApiTags('OB/GYN — Pregnancy Clinical Surface')
@Controller('visits/:visitId/journeys/:journeyId/clinical')
@UseGuards(EncounterMutationGuard)
export class PregnancyClinicalController {
  constructor(private readonly service: PregnancyClinicalService) {}

  @Get()
  @ApiStandardResponse(PregnancyClinicalEnvelopeDto)
  get(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Param('journeyId', ParseUUIDPipe) journeyId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.get(visitId, journeyId, user);
  }

  @Patch()
  @LocksOnClosedVisit('visitId')
  @ApiStandardResponse(PregnancyClinicalEnvelopeDto)
  patch(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Param('journeyId', ParseUUIDPipe) journeyId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: UpdatePregnancyClinicalDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patch(
      visitId,
      journeyId,
      ifMatch,
      dto as Record<string, unknown>,
      user,
    );
  }
}
