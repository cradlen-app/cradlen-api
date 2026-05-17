import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PatientMedicationsService } from './patient-medications.service';
import { PatientMedicationDto } from './dto/patient-medication.dto';
import { ApiStandardResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

// Read-only. Writes go through `PATCH /patients/:id/obgyn-history`.
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
}
