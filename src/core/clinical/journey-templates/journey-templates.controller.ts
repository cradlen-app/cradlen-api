import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiQuery } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { JourneyTemplatesService } from './journey-templates.service';
import { ApiStandardResponse } from '@common/swagger';
import { JourneyTemplateDto } from './dto/journey-template.dto';

class ListTemplatesQueryDto {
  @IsOptional() @IsUUID() specialtyId?: string;
}

@ApiTags('Journey Templates')
@Controller('journey-templates')
export class JourneyTemplatesController {
  constructor(private readonly service: JourneyTemplatesService) {}

  @Get()
  @ApiQuery({ name: 'specialtyId', required: false })
  @ApiStandardResponse(JourneyTemplateDto)
  findAll(@Query() query: ListTemplatesQueryDto) {
    return this.service.findAll(query.specialtyId);
  }

  @Get(':id')
  @ApiStandardResponse(JourneyTemplateDto)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
