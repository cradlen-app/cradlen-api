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
import { ObgynEncounterService } from './obgyn-encounter.service';
import {
  UpdateObgynEncounterDto,
  VisitObgynEncounterDto,
} from './dto/obgyn-encounter.dto';

@ApiTags('OB/GYN — Visit Encounter')
@Controller('visits/:id/obgyn-encounter')
@UseGuards(EncounterMutationGuard)
export class ObgynEncounterController {
  constructor(private readonly service: ObgynEncounterService) {}

  @Get()
  @ApiStandardResponse(VisitObgynEncounterDto)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.get(id, user);
  }

  /**
   * Save the entire OB/GYN examination tab in one request. Locked once the
   * parent visit is closed (`@LocksOnClosedVisit`); use the amendment flow
   * after that.
   */
  @Patch()
  @LocksOnClosedVisit('id')
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description:
      'Optimistic concurrency token. Echo the row\'s current `version` as `"version:N"`.',
  })
  @ApiStandardResponse(VisitObgynEncounterDto)
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateObgynEncounterDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patch(id, dto, version, user);
  }
}
