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
import { PatientMedicationsService } from './patient-medications.service';
import {
  CreatePatientMedicationDto,
  PatientMedicationDto,
  UpdatePatientMedicationDto,
} from './dto/patient-medication.dto';
import { ApiStandardResponse, ApiVoidResponse } from '../../common/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

@ApiTags('Patient History')
@Controller()
export class PatientMedicationsController {
  constructor(
    private readonly patientMedicationsService: PatientMedicationsService,
  ) {}

  @Get('patients/:id/medications')
  @ApiStandardResponse(PatientMedicationDto)
  findAll(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.patientMedicationsService.findAll(id, user);
  }

  @Post('patients/:id/medications')
  @ApiStandardResponse(PatientMedicationDto)
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePatientMedicationDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.patientMedicationsService.create(id, dto, user);
  }

  @Patch('patient-medications/:id')
  @ApiStandardResponse(PatientMedicationDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientMedicationDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.patientMedicationsService.update(id, dto, user);
  }

  @Delete('patient-medications/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.patientMedicationsService.remove(id, user);
  }
}
