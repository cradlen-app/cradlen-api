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
import { AllergiesService } from './allergies.service';
import {
  AllergyDto,
  CreateAllergyDto,
  UpdateAllergyDto,
} from './dto/allergy.dto';
import { ApiStandardResponse, ApiVoidResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

@ApiTags('Patient History')
@Controller()
export class AllergiesController {
  constructor(private readonly allergiesService: AllergiesService) {}

  @Get('patients/:id/allergies')
  @ApiStandardResponse(AllergyDto)
  findAll(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.allergiesService.findAll(id, user);
  }

  @Post('patients/:id/allergies')
  @ApiStandardResponse(AllergyDto)
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAllergyDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.allergiesService.create(id, dto, user);
  }

  @Patch('allergies/:id')
  @ApiStandardResponse(AllergyDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAllergyDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.allergiesService.update(id, dto, user);
  }

  @Delete('allergies/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.allergiesService.remove(id, user);
  }
}
