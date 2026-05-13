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
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPaginatedResponse, ApiStandardResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { MedicalRepService } from './medical-rep.service';
import { BookMedicalRepVisitDto } from './dto/book-medical-rep-visit.dto';
import { ListMedicalRepsQueryDto } from './dto/list-medical-reps.query';
import { MedicalRepDto, MedicalRepSummaryDto } from './dto/medical-rep.dto';
import { UpdateMedicalRepVisitDto } from './dto/update-medical-rep-visit.dto';
import { UpdateMedicalRepVisitStatusDto } from './dto/update-medical-rep-visit-status.dto';

class ListMedicalRepVisitsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number =
    20;
  @IsOptional() @IsUUID() branch_id?: string;
}

@ApiTags('medical-reps')
@Controller({ version: '1' })
export class MedicalRepController {
  constructor(private readonly service: MedicalRepService) {}

  @Get('medical-reps')
  @ApiPaginatedResponse(MedicalRepSummaryDto)
  async search(
    @Query() query: ListMedicalRepsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.searchReps(user, query);
  }

  @Get('medical-reps/:id')
  @ApiStandardResponse(MedicalRepDto)
  async getRep(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.findOne(id, user);
  }

  @Post('medical-rep-visits/book')
  @ApiStandardResponse(MedicalRepDto)
  async bookVisit(
    @Body() dto: BookMedicalRepVisitDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.bookVisit(dto, user);
  }

  @Get('medical-rep-visits')
  @ApiPaginatedResponse(MedicalRepDto)
  async listVisits(
    @Query() query: ListMedicalRepVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.listVisits(user, query);
  }

  @Get('medical-rep-visits/my-waiting-list')
  @ApiPaginatedResponse(MedicalRepDto)
  async myWaitingList(
    @Query() query: ListMedicalRepVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.findMyWaitingList(query, user);
  }

  @Get('medical-rep-visits/my-current')
  @ApiStandardResponse(MedicalRepDto)
  async myCurrent(@CurrentUser() user: AuthContext) {
    return this.service.findMyCurrent(user);
  }

  @Get('branches/:branchId/medical-rep-visits/waiting-list')
  @ApiPaginatedResponse(MedicalRepDto)
  async branchWaitingList(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListMedicalRepVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.findBranchWaitingList(branchId, query, user);
  }

  @Get('branches/:branchId/medical-rep-visits/in-progress')
  @ApiPaginatedResponse(MedicalRepDto)
  async branchInProgress(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListMedicalRepVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.findBranchInProgress(branchId, query, user);
  }

  @Get('medical-rep-visits/:id')
  @ApiStandardResponse(MedicalRepDto)
  async getVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.findVisit(id, user);
  }

  @Patch('medical-rep-visits/:id')
  @ApiStandardResponse(MedicalRepDto)
  async updateVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMedicalRepVisitDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.updateVisit(id, dto, user);
  }

  @Patch('medical-rep-visits/:id/status')
  @ApiStandardResponse(MedicalRepDto)
  async updateVisitStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMedicalRepVisitStatusDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.updateVisitStatus(id, dto, user);
  }
}
