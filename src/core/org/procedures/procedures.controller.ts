import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import {
  ProcedureLookupDto,
  ProceduresLookupQueryDto,
} from './dto/procedure.dto.js';
import { ProceduresService } from './procedures.service.js';

@ApiTags('Procedures')
@Controller('procedures')
export class ProceduresController {
  constructor(private readonly proceduresService: ProceduresService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Lookup procedures (active, filterable by specialty/search)',
  })
  @ApiStandardResponse(ProcedureLookupDto)
  findLookup(@Query() query: ProceduresLookupQueryDto) {
    return this.proceduresService.findLookup({
      specialtyId: query.specialty_id,
      search: query.search,
    });
  }
}
