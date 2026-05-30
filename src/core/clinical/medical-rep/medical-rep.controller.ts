import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { MedicalRepService } from './medical-rep.service';
import { MedicalRepVisitService } from './medical-rep-visit.service';
import { BookMedicalRepVisitDto } from './dto/book-medical-rep-visit.dto';
import { ListMedicalRepsQueryDto } from './dto/list-medical-reps.query';
import { MedicalRepDto, MedicalRepSummaryDto } from './dto/medical-rep.dto';
import {
  MedicalRepMedicationLinkDto,
  ReplaceMedicalRepMedicationsDto,
} from './dto/medical-rep-medications.dto';
import { UpdateMedicalRepVisitDto } from './dto/update-medical-rep-visit.dto';
import { UpdateMedicalRepVisitStatusDto } from './dto/update-medical-rep-visit-status.dto';
import { ListMedicalRepVisitsQueryDto } from './dto/list-medical-rep-visits.query';

@ApiTags('medical-reps')
@Controller({ version: '1' })
export class MedicalRepController {
  constructor(
    private readonly repService: MedicalRepService,
    private readonly visitService: MedicalRepVisitService,
  ) {}

  @Get('medical-reps')
  @ApiPaginatedResponse(MedicalRepSummaryDto)
  async search(
    @Query() query: ListMedicalRepsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.repService.searchReps(user, query);
  }

  @Get('medical-reps/companies')
  @ApiStandardResponse(String)
  async findCompanies(
    @Query('search') search: string = '',
    @CurrentUser() user: AuthContext,
  ) {
    return this.repService.findCompanies(search, user.organizationId);
  }

  @Get('medical-reps/:id')
  @ApiStandardResponse(MedicalRepDto)
  async getRep(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.repService.findOne(id, user);
  }

  @Get('medical-reps/:repId/medications')
  @ApiStandardResponse(MedicalRepMedicationLinkDto)
  async listRepMedications(
    @Param('repId', ParseUUIDPipe) repId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.repService.listMedicationsForRep(repId, user);
  }

  @Put('medical-reps/:repId/medications')
  @ApiStandardResponse(MedicalRepMedicationLinkDto)
  async replaceRepMedications(
    @Param('repId', ParseUUIDPipe) repId: string,
    @Body() dto: ReplaceMedicalRepMedicationsDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.repService.replaceMedicationsForRep(
      repId,
      dto.medication_ids,
      user,
    );
  }

  @Delete('medical-reps/:repId/medications/:medicationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiVoidResponse()
  async unlinkRepMedication(
    @Param('repId', ParseUUIDPipe) repId: string,
    @Param('medicationId', ParseUUIDPipe) medicationId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.repService.unlinkMedicationFromRep(repId, medicationId, user);
  }

  @Post('medical-rep-visits/book')
  @ApiStandardResponse(MedicalRepDto)
  async bookVisit(
    @Body() dto: BookMedicalRepVisitDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitService.bookVisit(dto, user);
  }

  @Get('medical-rep-visits')
  @ApiPaginatedResponse(MedicalRepDto)
  async listVisits(
    @Query() query: ListMedicalRepVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitService.listVisits(user, query);
  }

  @Get('medical-rep-visits/my-waiting-list')
  @ApiPaginatedResponse(MedicalRepDto)
  async myWaitingList(
    @Query() query: ListMedicalRepVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitService.findMyWaitingList(query, user);
  }

  @Get('medical-rep-visits/my-current')
  @ApiStandardResponse(MedicalRepDto)
  async myCurrent(@CurrentUser() user: AuthContext) {
    return this.visitService.findMyCurrent(user);
  }

  @Get('branches/:branchId/medical-rep-visits/waiting-list')
  @ApiPaginatedResponse(MedicalRepDto)
  async branchWaitingList(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListMedicalRepVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitService.findBranchWaitingList(branchId, query, user);
  }

  @Get('branches/:branchId/medical-rep-visits/in-progress')
  @ApiPaginatedResponse(MedicalRepDto)
  async branchInProgress(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListMedicalRepVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitService.findBranchInProgress(branchId, query, user);
  }

  @Get('medical-rep-visits/:id')
  @ApiStandardResponse(MedicalRepDto)
  async getVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitService.findVisit(id, user);
  }

  @Patch('medical-rep-visits/:id')
  @ApiStandardResponse(MedicalRepDto)
  async updateVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMedicalRepVisitDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitService.updateVisit(id, dto, user);
  }

  @Patch('medical-rep-visits/:id/status')
  @ApiStandardResponse(MedicalRepDto)
  async updateVisitStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMedicalRepVisitStatusDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitService.updateVisitStatus(id, dto, user);
  }
}
