import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ContraceptivesService } from './contraceptives.service';
import { ContraceptiveDto } from './dto/contraceptive.dto';
import { ApiStandardResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

// Read-only. Writes go through `PATCH /patients/:id/obgyn-history`.
@ApiTags('Patient History')
@Controller()
export class ContraceptivesController {
  constructor(private readonly contraceptivesService: ContraceptivesService) {}

  @Get('patients/:id/contraceptives')
  @ApiStandardResponse(ContraceptiveDto)
  findAll(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.contraceptivesService.findAll(id, user);
  }
}
