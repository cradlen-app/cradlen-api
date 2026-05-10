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
import { PregnanciesService } from './pregnancies.service';
import {
  CreatePregnancyDto,
  PregnancyDto,
  UpdatePregnancyDto,
} from './dto/pregnancy.dto';
import { ApiStandardResponse, ApiVoidResponse } from '../../common/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

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

  @Post('patients/:id/pregnancies')
  @ApiStandardResponse(PregnancyDto)
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePregnancyDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.pregnanciesService.create(id, dto, user);
  }

  @Patch('pregnancies/:id')
  @ApiStandardResponse(PregnancyDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePregnancyDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.pregnanciesService.update(id, dto, user);
  }

  @Delete('pregnancies/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.pregnanciesService.remove(id, user);
  }
}
