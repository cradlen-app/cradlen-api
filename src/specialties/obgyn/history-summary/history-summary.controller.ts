import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { HistorySummaryService } from './history-summary.service';
import { ObgynHistorySummaryDto } from './dto/obgyn-history-summary.dto';

@ApiTags('OB/GYN — History Summary')
@Controller('patients/:id/obgyn-history-summary')
export class HistorySummaryController {
  constructor(private readonly service: HistorySummaryService) {}

  @Get()
  @ApiStandardResponse(ObgynHistorySummaryDto)
  getHistorySummary(
    @Param('id', ParseUUIDPipe) patientId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<ObgynHistorySummaryDto> {
    return this.service.getObgynHistorySummary(patientId, user);
  }
}
