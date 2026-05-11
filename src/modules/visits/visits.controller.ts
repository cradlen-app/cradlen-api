import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import { BookRepVisitDto } from './dto/book-rep-visit.dto';
import { UpdateRepEncounterDto } from './dto/update-rep-encounter.dto';
import { CreateVisitDto } from './dto/create-visit.dto';
import { UpdateVisitDto } from './dto/update-visit.dto';
import { UpdateVisitStatusDto } from './dto/update-visit-status.dto';
import { SetFollowUpDto } from './dto/set-follow-up.dto';
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

  @Post('visits/book-rep')
  @ApiOperation({
    summary:
      'Book a medical-rep visit. Provide medical_rep_id (existing) or new_medical_rep (creates a rep in the same transaction).',
  })
  @ApiStandardResponse(VisitDto)
  bookRepVisit(@Body() dto: BookRepVisitDto, @CurrentUser() user: AuthContext) {
    return this.visitsService.bookRepVisit(dto, user);
  }

  @Put('visits/:id/rep-encounter')
  @ApiOperation({
    summary:
      'Upsert the medical-rep encounter (drugs detailed, samples, follow-up) for a MEDICAL_REP visit.',
  })
  upsertRepEncounter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRepEncounterDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.upsertRepEncounter(id, dto, user);
  }

  @Get('visits/my-waiting-list')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Today's SCHEDULED + CHECKED_IN visits assigned to the current doctor",
  })
  @ApiPaginatedResponse(VisitDto)
  findMyWaitingList(
    @Query() query: ListVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.findMyWaitingList(query, user);
  }

  @Get('visits/my-current')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Current IN_PROGRESS visit assigned to the doctor (data may be null)',
  })
  @ApiStandardResponse(VisitDto)
  findMyCurrent(@CurrentUser() user: AuthContext) {
    return this.visitsService.findMyCurrent(user);
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

  @Put('visits/:id/follow-up')
  @ApiStandardResponse(VisitDto)
  setFollowUp(
    @Param('id') id: string,
    @Body() dto: SetFollowUpDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.setFollowUp(id, dto, user);
  }

  @Get('branches/:branchId/visits/waiting-list')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Today's SCHEDULED + CHECKED_IN visits for a branch",
  })
  @ApiPaginatedResponse(VisitDto)
  findBranchWaitingList(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.findBranchWaitingList(branchId, query, user);
  }

  @Get('branches/:branchId/visits/in-progress')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Today's IN_PROGRESS visits for a branch" })
  @ApiPaginatedResponse(VisitDto)
  findBranchInProgress(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitsService.findBranchInProgress(branchId, query, user);
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
