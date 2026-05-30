import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator.js';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { SpecialtiesService } from './specialties.service.js';
import { ApiStandardResponse } from '@common/swagger/index.js';
import { SpecialtyDto, SpecialtyLookupDto } from './dto/specialty.dto.js';

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
  @ApiOperation({
    summary: "List specialties subscribed to by the caller's organization",
  })
  @ApiStandardResponse(SpecialtyDto)
  findAll(@CurrentUser() user: AuthContext) {
    return this.specialtiesService.findAll(user.organizationId);
  }
}
