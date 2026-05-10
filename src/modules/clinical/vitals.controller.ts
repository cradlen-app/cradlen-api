import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VitalsService } from './vitals.service';
import { UpsertVitalsDto, VitalsDto } from './dto/vitals.dto';
import { ApiStandardResponse } from '../../common/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

@ApiTags('Clinical')
@Controller('visits/:id/vitals')
export class VitalsController {
  constructor(private readonly vitalsService: VitalsService) {}

  @Get()
  @ApiStandardResponse(VitalsDto)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.vitalsService.findOne(id, user);
  }

  @Put()
  @ApiStandardResponse(VitalsDto)
  upsert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertVitalsDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.vitalsService.upsert(id, dto, user);
  }
}
