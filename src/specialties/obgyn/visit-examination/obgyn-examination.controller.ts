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
import { ObgynExaminationService } from './obgyn-examination.service';
import {
  UpdateObgynExaminationDto,
  VisitExaminationEnvelopeDto,
} from './dto/obgyn-examination.dto';

/**
 * Unified Examination tab. Single GET / PATCH pair orchestrating five
 * underlying aggregates inside one transaction (see service for details).
 * Optimistic concurrency uses a single `Visit.examination_version` token.
 */
@ApiTags('OB/GYN — Visit Examination')
@Controller('visits/:id/examination')
@UseGuards(EncounterMutationGuard)
export class ObgynExaminationController {
  constructor(private readonly service: ObgynExaminationService) {}

  @Get()
  @ApiStandardResponse(VisitExaminationEnvelopeDto)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.get(id, user);
  }

  @Patch()
  @LocksOnClosedVisit('id')
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description:
      'Optimistic concurrency token. Echo `Visit.examination_version` as `"version:N"`.',
  })
  @ApiStandardResponse(VisitExaminationEnvelopeDto)
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateObgynExaminationDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patch(id, dto, version, user);
  }
}
