import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ContraceptivesService } from './contraceptives.service';
import {
  ContraceptiveDto,
  CreateContraceptiveDto,
  UpdateContraceptiveDto,
} from './dto/contraceptive.dto';
import { ApiStandardResponse, ApiVoidResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

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

  @Post('patients/:id/contraceptives')
  @ApiStandardResponse(ContraceptiveDto)
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateContraceptiveDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.contraceptivesService.create(id, dto, user);
  }

  @Patch('contraceptives/:id')
  @ApiStandardResponse(ContraceptiveDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContraceptiveDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.contraceptivesService.update(id, dto, user);
  }

  @Delete('contraceptives/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.contraceptivesService.remove(id, user);
  }
}
