import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VisitStatus } from '@prisma/client';
import { VisitsService } from './visits.service';
import { BookVisitDto } from './dto/book-visit.dto';
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

class ListBranchVisitsQueryDto {
  @IsNotEmpty() @IsEnum(VisitStatus) status!: VisitStatus;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
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

  @Post('visits/book')
  @ApiStandardResponse(VisitDto)
  bookVisit(@Body() dto: BookVisitDto, @CurrentUser() user: AuthContext) {
    return this.visitsService.bookVisit(dto, user);
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

  @Get('branches/:branchId/visits')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List visits for a branch filtered by status' })
  @ApiQuery({ name: 'status', enum: VisitStatus, required: true })
  @ApiQuery({
    name: 'from',
    required: false,
    description:
      'ISO datetime with timezone offset (e.g. 2026-05-06T00:00:00+03:00)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description:
      'ISO datetime with timezone offset (e.g. 2026-05-06T23:59:59+03:00)',
  })
  @ApiPaginatedResponse(VisitDto)
  findAllForBranch(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListBranchVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.findAllForBranch(
      branchId,
      query.status,
      { page: query.page, limit: query.limit, from: query.from, to: query.to },
      user,
    );
  }
}
