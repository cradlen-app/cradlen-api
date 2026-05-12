import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, ApiStandardResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { MedicalRepService } from './medical-rep.service';
import { BookMedicalRepVisitDto } from './dto/book-medical-rep-visit.dto';
import { ListMedicalRepsQueryDto } from './dto/list-medical-reps.query';
import { MedicalRepDto, MedicalRepSummaryDto } from './dto/medical-rep.dto';

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
    @Query() query: { page?: number; limit?: number; branch_id?: string },
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.listVisits(user, query);
  }

  @Get('medical-rep-visits/:id')
  @ApiStandardResponse(MedicalRepDto)
  async getVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.findVisit(id, user);
  }
}
