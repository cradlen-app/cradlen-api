import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AllergiesService } from './allergies.service';
import { AllergyDto } from './dto/allergy.dto';
import { ApiStandardResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

// Read-only. Writes go through `PATCH /patients/:id/obgyn-history`.
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
}
