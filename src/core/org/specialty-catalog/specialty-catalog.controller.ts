import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { SpecialtyCatalogService } from './specialty-catalog.service.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import {
  SpecialtyDto,
  SpecialtyLookupDto,
  SubspecialtyLookupDto,
} from './dto/specialty.dto.js';

@ApiTags('Specialties')
@Controller('specialties')
export class SpecialtyCatalogController {
  constructor(private readonly specialtiesService: SpecialtyCatalogService) {}

  @Public()
  @Get('lookup')
  @ApiOperation({
    summary:
      'List specialties (with nested subspecialties) for dropdowns (public)',
  })
  @ApiStandardResponse(SpecialtyLookupDto)
  findLookup() {
    return this.specialtiesService.findLookup();
  }

  @Public()
  @Get('subspecialties/lookup')
  @ApiOperation({
    summary: 'List subspecialties for dropdowns, optionally by parent (public)',
  })
  @ApiQuery({ name: 'parent_code', required: false })
  @ApiStandardResponse(SubspecialtyLookupDto)
  async subspecialtyLookup(
    @Query('parent_code') parentCode?: string,
  ): Promise<SubspecialtyLookupDto[]> {
    const rows = await this.specialtiesService.subspecialtyLookup(parentCode);
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      specialty_code: r.specialty.code,
    }));
  }

  @Get()
  @ApiOperation({
    summary: "List specialties subscribed to by the caller's organization",
  })
  @ApiStandardResponse(SpecialtyDto)
  findAll(@CurrentUser() user: AuthContext) {
    return this.specialtiesService.findAll(user.organizationId);
  }
}
