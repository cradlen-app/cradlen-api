import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import { PrescriptionsService } from './prescriptions.service.js';
import { PrescriptionPrintDto } from './dto/prescription-print.dto.js';

@ApiTags('Clinical — Prescriptions')
@ApiBearerAuth()
@Controller('visits/:visitId/prescription')
export class PrescriptionsController {
  constructor(private readonly prescriptionsService: PrescriptionsService) {}

  @Get('print')
  @ApiOperation({
    summary:
      "Printable aggregate for a visit's prescription plus the resolved layout template.",
  })
  @ApiStandardResponse(PrescriptionPrintDto)
  print(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.prescriptionsService.print(visitId, user);
  }
}
