import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags, ApiQuery } from '@nestjs/swagger';
import { JourneyTemplatesService } from './journey-templates.service';
import { ApiStandardResponse } from '@common/swagger';
import { JourneyTemplateDto } from './dto/journey-template.dto';
import { ListJourneyTemplatesQueryDto } from './dto/list-journey-templates.query';

@ApiTags('Journey Templates')
@Controller('journey-templates')
export class JourneyTemplatesController {
  constructor(private readonly service: JourneyTemplatesService) {}

  @Get()
  @ApiQuery({ name: 'specialtyId', required: false })
  @ApiStandardResponse(JourneyTemplateDto)
  findAll(@Query() query: ListJourneyTemplatesQueryDto) {
    return this.service.findAll(query.specialtyId);
  }

  @Get(':id')
  @ApiStandardResponse(JourneyTemplateDto)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }
}
