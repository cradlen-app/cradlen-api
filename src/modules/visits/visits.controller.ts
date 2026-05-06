import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { VisitsService } from './visits.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { UpdateVisitDto } from './dto/update-visit.dto';
import { UpdateVisitStatusDto } from './dto/update-visit-status.dto';
import { VisitDto } from './dto/visit.dto';
import {
  ApiStandardResponse,
  ApiPaginatedResponse,
} from '../../common/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

class ListVisitsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number =
    20;
}

@ApiTags('Visits')
@Controller()
export class VisitsController {
  constructor(private readonly visitsService: VisitsService) {}

  @Post('episodes/:episodeId/visits')
  @ApiStandardResponse(VisitDto)
  create(
    @Param('episodeId') episodeId: string,
    @Body() dto: CreateVisitDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.create(episodeId, dto, user);
  }

  @Get('episodes/:episodeId/visits')
  @ApiPaginatedResponse(VisitDto)
  findAll(
    @Param('episodeId') episodeId: string,
    @Query() query: ListVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.findAllForEpisode(episodeId, user, query);
  }

  @Get('visits/:id')
  @ApiStandardResponse(VisitDto)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return this.visitsService.findOne(id, user);
  }

  @Patch('visits/:id')
  @ApiStandardResponse(VisitDto)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateVisitDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.update(id, dto, user);
  }

  @Patch('visits/:id/status')
  @ApiStandardResponse(VisitDto)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateVisitStatusDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.updateStatus(id, dto, user);
  }
}
