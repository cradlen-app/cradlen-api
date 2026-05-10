import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EncounterService } from './encounter.service';
import { EncounterDto, UpsertEncounterDto } from './dto/encounter.dto';
import { ApiStandardResponse } from '../../common/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

@ApiTags('Clinical')
@Controller('visits/:id/encounter')
export class EncounterController {
  constructor(private readonly encounterService: EncounterService) {}

  @Get()
  @ApiStandardResponse(EncounterDto)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.encounterService.findOne(id, user);
  }

  @Put()
  @ApiStandardResponse(EncounterDto)
  upsert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertEncounterDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.encounterService.upsert(id, dto, user);
  }
}
