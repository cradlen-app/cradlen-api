import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger';
import { CurrentUser, IfMatchVersion } from '@common/decorators';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { ObgynHistoryService } from './obgyn-history.service';
import {
  PatientObgynHistoryDto,
  UpdateObgynHistoryDto,
} from './dto/obgyn-history.dto';

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

  /**
   * Save the entire OB/GYN history tab in one request.
   *
   * - Any subset of sections may be present in the body. Unsent fields are
   *   left untouched on the server.
   * - `If-Match: "version:N"` echoes the row's current version. Mismatch
   *   returns 412 STALE_VERSION with a diff hint.
   * - Server applies all changes atomically, snapshots the prior state to
   *   `patient_obgyn_history_revisions`, bumps `version`, and emits one
   *   `patient.history.updated` event listing the section codes that
   *   actually changed.
   */
  @Patch()
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description:
      'Optimistic concurrency token. Echo the row\'s current `version` as `"version:N"`.',
  })
  @ApiStandardResponse(PatientObgynHistoryDto)
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateObgynHistoryDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patch(id, dto, version, user);
  }
}
