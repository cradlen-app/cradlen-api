import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SpecialtiesService } from './specialties.service.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
} from '../../common/swagger/index.js';
import {
  SpecialtyDto,
  JourneyTemplateInSpecialtyDto,
} from './dto/specialty.dto.js';

@ApiTags('Specialties')
@Controller('specialties')
export class SpecialtiesController {
  constructor(private readonly specialtiesService: SpecialtiesService) {}

  @Get()
  @ApiPaginatedResponse(SpecialtyDto)
  findAll() {
    return this.specialtiesService.findAll();
  }

  @Get(':id/journey-templates')
  @ApiStandardResponse(JourneyTemplateInSpecialtyDto)
  findJourneyTemplates(@Param('id') id: string) {
    return this.specialtiesService.findJourneyTemplates(id);
  }
}
