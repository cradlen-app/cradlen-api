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
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MedicationsService } from './medications.service';
import { CreateMedicationDto } from './dto/create-medication.dto';
import { UpdateMedicationDto } from './dto/update-medication.dto';
import { ListMedicationsQueryDto } from './dto/list-medications-query.dto';
import { MedicationDto } from './dto/medication.dto';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

@ApiTags('Medications')
@Controller('medications')
export class MedicationsController {
  constructor(private readonly medicationsService: MedicationsService) {}

  @Get()
  @ApiPaginatedResponse(MedicationDto)
  findAll(
    @Query() query: ListMedicationsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.medicationsService.findAll(query, user);
  }

  @Post()
  @ApiStandardResponse(MedicationDto)
  create(@Body() dto: CreateMedicationDto, @CurrentUser() user: AuthContext) {
    return this.medicationsService.create(dto, user);
  }

  @Patch(':id')
  @ApiStandardResponse(MedicationDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMedicationDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.medicationsService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.medicationsService.remove(id, user);
  }
}
