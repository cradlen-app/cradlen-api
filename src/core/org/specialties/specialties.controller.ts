import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { SpecialtiesService } from './specialties.service.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import {
  SpecialtyDto,
  SpecialtyLookupDto,
  JourneyTemplateInSpecialtyDto,
} from './dto/specialty.dto.js';

@ApiTags('Specialties')
@Controller('specialties')
export class SpecialtiesController {
  constructor(private readonly specialtiesService: SpecialtiesService) {}

  @Public()
  @Get('lookup')
  @ApiOperation({ summary: 'List specialties for dropdowns (public)' })
  @ApiStandardResponse(SpecialtyLookupDto)
  findLookup() {
    return this.specialtiesService.findLookup();
  }

  @Get()
  @ApiStandardResponse(SpecialtyDto)
  findAll() {
    return this.specialtiesService.findAll();
  }

  @Get(':id/journey-templates')
  @ApiStandardResponse(JourneyTemplateInSpecialtyDto)
  findJourneyTemplates(@Param('id') id: string) {
    return this.specialtiesService.findJourneyTemplates(id);
  }
}
