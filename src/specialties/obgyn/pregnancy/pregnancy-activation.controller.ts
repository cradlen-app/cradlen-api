import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger';
import { CurrentUser, LocksOnClosedVisit } from '@common/decorators';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { EncounterMutationGuard } from '@core/clinical/visits/visits.public';
import { PregnancyActivationService } from './pregnancy-activation.service';
import {
  ClosePregnancyDto,
  CreatePregnancyDto,
  PregnancyProfileDto,
} from './dto/pregnancy-activation.dto';

/**
 * Pregnancy lifecycle endpoints sitting beside the clinical surface. Activation
 * is the drawer's "Create"; close records the delivery and completes the
 * journey. Both lock on a closed visit (post-close edits go via amendments).
 */
@ApiTags('OB/GYN — Pregnancy Lifecycle')
@Controller('visits/:visitId/pregnancy')
@UseGuards(EncounterMutationGuard)
export class PregnancyActivationController {
  constructor(private readonly service: PregnancyActivationService) {}

  @Post()
  @LocksOnClosedVisit('visitId')
  @ApiStandardResponse(PregnancyProfileDto)
  activate(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: CreatePregnancyDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.activate(visitId, dto, user);
  }

  @Post('close')
  @LocksOnClosedVisit('visitId')
  @ApiStandardResponse(PregnancyProfileDto)
  close(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: ClosePregnancyDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.close(visitId, dto, user);
  }
}
