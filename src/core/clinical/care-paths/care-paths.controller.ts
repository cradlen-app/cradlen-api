import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { CarePathsService } from './care-paths.service';
import { ApiStandardResponse } from '@common/swagger';
import { CarePathDto, CarePathEpisodeDto } from './dto/care-path.dto';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

class ListCarePathsQueryDto {
  @IsOptional() @IsUUID() specialtyId?: string;
  @IsOptional() @IsString() specialtyCode?: string;
}

@ApiTags('Care Paths')
@Controller('care-paths')
export class CarePathsController {
  constructor(private readonly service: CarePathsService) {}

  @Get()
  @ApiQuery({ name: 'specialtyId', required: false })
  @ApiQuery({ name: 'specialtyCode', required: false })
  @ApiStandardResponse(CarePathDto)
  findAll(
    @Query() query: ListCarePathsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.findAll({
      specialtyId: query.specialtyId,
      specialtyCode: query.specialtyCode,
      organizationId: user.organizationId,
    });
  }

  @Get(':id')
  @ApiStandardResponse(CarePathDto)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/episodes')
  @ApiStandardResponse(CarePathEpisodeDto)
  findEpisodes(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findEpisodes(id);
  }
}
