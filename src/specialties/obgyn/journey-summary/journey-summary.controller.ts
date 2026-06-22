import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { JourneySummaryService } from './journey-summary.service';
import { ActiveJourneySummaryDto } from './dto/active-journey-summary.dto';

@ApiTags('OB/GYN — Active Journey Summary')
@Controller('patients/:id/active-journey-summary')
export class JourneySummaryController {
  constructor(private readonly service: JourneySummaryService) {}

  @Get()
  @ApiStandardResponse(ActiveJourneySummaryDto)
  getActiveJourneySummary(
    @Param('id', ParseUUIDPipe) patientId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<ActiveJourneySummaryDto> {
    return this.service.getActiveJourneySummary(patientId, user);
  }
}
