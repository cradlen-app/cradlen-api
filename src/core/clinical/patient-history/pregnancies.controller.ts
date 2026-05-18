import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PregnanciesService } from './pregnancies.service';
import { PregnancyDto } from './dto/pregnancy.dto';
import { ApiStandardResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

// Writes go through the unified `PATCH /patients/:id/obgyn-history` so the
// singleton `version` token covers every history mutation. This controller
// is read-only by design.
@ApiTags('Patient History')
@Controller()
export class PregnanciesController {
  constructor(private readonly pregnanciesService: PregnanciesService) {}

  @Get('patients/:id/pregnancies')
  @ApiStandardResponse(PregnancyDto)
  findAll(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.pregnanciesService.findAll(id, user);
  }
}
