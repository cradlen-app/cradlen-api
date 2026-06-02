import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { MedicalRepVisitExaminationService } from './medical-rep-visit-examination.service';
import { UpdateMedicalRepVisitExaminationDto } from './dto/update-medical-rep-visit-examination.dto';
import { MedicalRepVisitExaminationEnvelopeDto } from './dto/medical-rep-visit-examination.envelope.dto';

/**
 * Medical-rep visit examination tab — one GET / PATCH pair over a single
 * envelope. Last-write-wins on open visits (`examination_version` increments
 * as a change/cache token). Closed visits (COMPLETED/CANCELLED/NO_SHOW) are
 * rejected by the service with `409 ENCOUNTER_LOCKED`.
 */
@ApiTags('medical-reps — Visit Examination')
@Controller('medical-rep-visits/:id/examination')
export class MedicalRepVisitExaminationController {
  constructor(private readonly service: MedicalRepVisitExaminationService) {}

  @Get()
  @ApiStandardResponse(MedicalRepVisitExaminationEnvelopeDto)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.get(id, user);
  }

  @Patch()
  @ApiStandardResponse(MedicalRepVisitExaminationEnvelopeDto)
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMedicalRepVisitExaminationDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patch(id, dto, user);
  }
}
