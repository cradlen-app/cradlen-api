import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger';
import {
  ApiIfMatchHeader,
  CurrentUser,
  IfMatchVersion,
} from '@common/decorators';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { AmendmentsService } from './amendments.service';
import { AmendmentResultDto, CreateAmendmentDto } from './dto/amendment.dto';

@ApiTags('OB/GYN — Amendments')
@Controller('visits/:visitId/amendments')
export class AmendmentsController {
  constructor(private readonly service: AmendmentsService) {}

  /**
   * Amend a closed visit's encounter or pregnancy record.
   *
   * Required:
   * - Visit status must be `COMPLETED` or `CANCELLED`.
   * - Caller must be the assigned doctor OR an organization `OWNER`.
   * - Body must include a non-empty `reason` (min 8 chars).
   * - `If-Match: "version:N"` header echoes the target row's current version.
   *
   * Behavior:
   * - Applies `changes` to the named `target` (+ `section` for fan-out tables).
   * - Persists a snapshot of the prior row to the target's `*_revisions`
   *   shadow table, bumps the row's `version`, and records the amendment
   *   metadata in the response (all in one transaction).
   */
  @Post()
  @ApiIfMatchHeader(
    'Optimistic concurrency token. Echo the target row\'s current `version` as `"version:N"`.',
  )
  @ApiStandardResponse(AmendmentResultDto)
  create(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: CreateAmendmentDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.createForVisit(visitId, dto, user, version);
  }
}
