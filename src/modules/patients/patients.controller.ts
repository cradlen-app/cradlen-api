import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { ListPatientsQueryDto } from './dto/list-patients-query.dto';
import { ListBranchPatientsQueryDto } from './dto/list-branch-patients-query.dto';
import { PatientDto, BranchPatientDto } from './dto/patient.dto';
import {
  ApiStandardResponse,
  ApiPaginatedResponse,
} from '../../common/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

@ApiTags('Patients')
@Controller()
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post('/patients')
  @ApiStandardResponse(PatientDto)
  create(@Body() dto: CreatePatientDto) {
    return this.patientsService.create(dto);
  }

  @Get('/patients')
  @ApiPaginatedResponse(PatientDto)
  findAll(
    @Query() query: ListPatientsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.patientsService.findAll(query, user);
  }

  @Get('/patients/:id')
  @ApiStandardResponse(PatientDto)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.patientsService.findOne(id);
  }

  @Patch('/patients/:id')
  @ApiStandardResponse(PatientDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientDto,
  ) {
    return this.patientsService.update(id, dto);
  }

  @Get('/branches/:branchId/patients')
  @ApiPaginatedResponse(BranchPatientDto)
  findAllForBranch(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListBranchPatientsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.patientsService.findAllForBranch(branchId, query, user);
  }
}
