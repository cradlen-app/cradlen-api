import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { ListPatientsQueryDto } from './dto/list-patients-query.dto';
import { PatientDto } from './dto/patient.dto';
import {
  ApiStandardResponse,
  ApiPaginatedResponse,
} from '../../common/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

@ApiTags('Patients')
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @ApiStandardResponse(PatientDto)
  create(@Body() dto: CreatePatientDto) {
    return this.patientsService.create(dto);
  }

  @Get()
  @ApiPaginatedResponse(PatientDto)
  findAll(
    @Query() query: ListPatientsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.patientsService.findAll(query, user);
  }

  @Get(':id')
  @ApiStandardResponse(PatientDto)
  findOne(@Param('id') id: string) {
    return this.patientsService.findOne(id);
  }

  @Patch(':id')
  @ApiStandardResponse(PatientDto)
  update(@Param('id') id: string, @Body() dto: UpdatePatientDto) {
    return this.patientsService.update(id, dto);
  }
}
