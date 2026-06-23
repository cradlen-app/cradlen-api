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
import { SurgicalActivationService } from './surgical-activation.service';
import {
  CloseSurgicalDto,
  CreateSurgicalDto,
  SurgicalProfileDto,
} from './dto/surgical-activation.dto';

/**
 * Surgical lifecycle endpoints sitting beside the clinical surface. Activation is
 * the drawer's "Create" (with the cesarean handoff when a pregnancy is active);
 * close records the outcome and completes the journey. Both lock on a closed
 * visit (post-close edits go via amendments).
 */
@ApiTags('OB/GYN — Surgical Lifecycle')
@Controller('visits/:visitId/surgical')
@UseGuards(EncounterMutationGuard)
export class SurgicalActivationController {
  constructor(private readonly service: SurgicalActivationService) {}

  @Post()
  @LocksOnClosedVisit('visitId')
  @ApiStandardResponse(SurgicalProfileDto)
  activate(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: CreateSurgicalDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.activate(visitId, dto, user);
  }

  @Post('close')
  @LocksOnClosedVisit('visitId')
  @ApiStandardResponse(SurgicalProfileDto)
  close(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: CloseSurgicalDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.close(visitId, dto, user);
  }
}
