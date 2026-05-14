import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ProceduresService } from './procedures.service.js';

class ProceduresLookupQueryDto {
  @IsOptional()
  @IsUUID()
  specialty_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

@ApiTags('Procedures')
@Controller({ path: 'procedures', version: '1' })
export class ProceduresController {
  constructor(private readonly proceduresService: ProceduresService) {}

  @Get()
  @ApiOperation({
    summary: 'Lookup procedures (active, filterable by specialty/search)',
  })
  lookup(@Query() query: ProceduresLookupQueryDto) {
    return this.proceduresService.lookup({
      specialtyId: query.specialty_id,
      search: query.search,
    });
  }
}
