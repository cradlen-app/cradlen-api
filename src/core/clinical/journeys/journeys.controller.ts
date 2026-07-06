import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JourneysService } from './journeys.service';
import { ApiStandardResponse } from '@common/swagger';
import { JourneyDescriptorDto } from './dto/journey-descriptor.dto';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuditsPhiAccess } from '@common/decorators/audits-phi-access.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

@ApiTags('Journeys')
@Controller('visits/:visitId')
export class JourneysController {
  constructor(private readonly service: JourneysService) {}

  /**
   * The journey + clinical-surface descriptor for a visit's workspace. Returns
   * `null` (wrapped as `{ data: null }`) when the visit has no journey.
   */
  @Get('journey')
  @AuditsPhiAccess({
    resource: 'visit.journey_descriptor',
    param: 'visitId',
    subjectType: 'VISIT',
    purpose: 'treatment',
  })
  @ApiStandardResponse(JourneyDescriptorDto)
  getJourney(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.getActiveJourneyForVisit(visitId, user);
  }
}
