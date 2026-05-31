import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { ObgynHistoryService } from './obgyn-history.service';
import { PatientObgynHistoryDto } from './dto/obgyn-history.dto';

/**
 * OB/GYN patient history is a READ-ONLY surface — the "specialty full history"
 * view rendered in the frontend. The GET returns the full envelope (singleton
 * sections + the five child collections + version).
 *
 * History is no longer written through a standalone PATCH here; capture
 * relocates into the OB/GYN examination flow, which calls
 * `ObgynHistoryService.patch` internally. See the matching display-only form
 * template (`obgyn_patient_history`, `is_display_only = true`).
 */
@ApiTags('OB/GYN — Patient History')
@Controller('patients/:id/obgyn-history')
export class ObgynHistoryController {
  constructor(private readonly service: ObgynHistoryService) {}

  @Get()
  @ApiStandardResponse(PatientObgynHistoryDto)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.get(id, user);
  }
}
