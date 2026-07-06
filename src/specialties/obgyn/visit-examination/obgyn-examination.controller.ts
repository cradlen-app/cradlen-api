import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger';
import {
  AuditsPhiAccess,
  CurrentUser,
  LocksOnClosedVisit,
} from '@common/decorators';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { EncounterMutationGuard } from '@core/clinical/visits/visits.public';
import { ObgynExaminationService } from './obgyn-examination.service';
import {
  UpdateObgynExaminationDto,
  VisitExaminationEnvelopeDto,
} from './dto/obgyn-examination.dto';

/**
 * Unified Examination tab. Single GET / PATCH pair orchestrating five
 * underlying aggregates inside one transaction (see service for details).
 * The PATCH is last-write-wins on open visits (no `If-Match` precondition);
 * `Visit.examination_version` still increments as a change/cache token.
 * Closed visits are blocked by `EncounterMutationGuard` (edits go via amendments).
 */
@ApiTags('OB/GYN — Visit Examination')
@Controller('visits/:id/examination')
@UseGuards(EncounterMutationGuard)
export class ObgynExaminationController {
  constructor(private readonly service: ObgynExaminationService) {}

  @Get()
  @AuditsPhiAccess({
    resource: 'visit.examination',
    param: 'id',
    subjectType: 'VISIT',
    purpose: 'treatment',
  })
  @ApiStandardResponse(VisitExaminationEnvelopeDto)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.get(id, user);
  }

  @Patch()
  @LocksOnClosedVisit('id')
  @ApiStandardResponse(VisitExaminationEnvelopeDto)
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateObgynExaminationDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patch(id, dto, user);
  }
}
