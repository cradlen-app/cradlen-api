import { Controller, Get, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ChiefComplaintsService } from './chief-complaints.service';
import { ApiStandardResponse } from '@common/swagger';

class ChiefComplaintCategoryDto {
  code!: string;
  label!: string;
}

class ListChiefComplaintCategoriesQueryDto {
  @IsString() specialty_code!: string;
  @IsOptional() @IsString() care_path_code?: string;
}

@ApiTags('Chief Complaint Categories')
@Controller('chief-complaint-categories')
export class ChiefComplaintsController {
  constructor(private readonly service: ChiefComplaintsService) {}

  @Get()
  @ApiQuery({ name: 'specialty_code', required: true })
  @ApiQuery({ name: 'care_path_code', required: false })
  @ApiStandardResponse(ChiefComplaintCategoryDto)
  findAll(@Query() query: ListChiefComplaintCategoriesQueryDto) {
    return this.service.findBySpecialty(
      query.specialty_code,
      query.care_path_code,
    );
  }
}
