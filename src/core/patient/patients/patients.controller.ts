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
import { PatientsService } from './patients.service.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { ListPatientsQueryDto } from './dto/list-patients-query.dto.js';
import { ListBranchPatientsQueryDto } from './dto/list-branch-patients-query.dto.js';
import { BranchPatientStatsQueryDto } from './dto/branch-patient-stats-query.dto.js';
import {
  PatientDto,
  PatientLookupDto,
  BranchPatientDto,
} from './dto/patient.dto.js';
import { PatientStatsDto } from './dto/patient-stats.dto.js';
import { ApiStandardResponse, ApiPaginatedResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import { AuthContext } from '@common/interfaces/auth-context.interface.js';

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
  @ApiPaginatedResponse(PatientLookupDto)
  findAll(
    @Query() query: ListPatientsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.patientsService.findAll(query, user);
  }

  @Get('/patients/directory')
  @ApiPaginatedResponse(BranchPatientDto)
  findAllForOrg(
    @Query() query: ListBranchPatientsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.patientsService.findAllForOrg(query, user);
  }

  // Declared before `/patients/:id` so "stats" isn't parsed as a patient id.
  @Get('/patients/stats')
  @ApiStandardResponse(PatientStatsDto)
  orgStats(@CurrentUser() user: AuthContext) {
    return this.patientsService.getOrgStats(user);
  }

  @Get('/patients/:id')
  @ApiStandardResponse(PatientDto)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.patientsService.findOne(id, user);
  }

  @Patch('/patients/:id')
  @ApiStandardResponse(PatientDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.patientsService.update(id, dto, user);
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

  @Get('/branches/:branchId/patients/stats')
  @ApiStandardResponse(PatientStatsDto)
  branchStats(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: BranchPatientStatsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.patientsService.getBranchStats(
      branchId,
      user,
      query.assigned_to_me ?? false,
    );
  }
}
