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
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiStandardArrayResponse,
  ApiVoidResponse,
} from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PermissionGuard } from '@common/guards/permission.guard';
import { RequirePermission } from '@common/decorators/require-permission.decorator';
import { PERMISSIONS } from '@common/authorization/permission-matrix';
import { MedicalRepService } from './medical-rep.service';
import { MedicalRepVisitService } from './medical-rep-visit.service';
import { BookMedicalRepVisitDto } from './dto/book-medical-rep-visit.dto';
import { ListMedicalRepsQueryDto } from './dto/list-medical-reps.query';
import { MedicalRepDto, MedicalRepListItemDto } from './dto/medical-rep.dto';
import {
  MedicalRepMedicationLinkDto,
  ReplaceMedicalRepMedicationsDto,
} from './dto/medical-rep-medications.dto';
import { UpdateMedicalRepVisitDto } from './dto/update-medical-rep-visit.dto';
import { UpdateMedicalRepVisitStatusDto } from './dto/update-medical-rep-visit-status.dto';
import { ListMedicalRepVisitsQueryDto } from './dto/list-medical-rep-visits.query';
import { MedicalRepVisitHistoryItemDto } from './dto/medical-rep-visit-history.dto';

@ApiTags('medical-reps')
@Controller({ version: '1' })
// Coarse capability gate: the guard is a no-op on routes without
// `@RequirePermission`, so finer-scoped endpoints keep their service-layer
// authorization unchanged. The read surface below is annotated to match the
// frontend `medicalRep.view` nav gate (managers + doctors).
@UseGuards(PermissionGuard)
export class MedicalRepController {
  constructor(
    private readonly repService: MedicalRepService,
    private readonly visitService: MedicalRepVisitService,
  ) {}

  @Get('medical-reps')
  @RequirePermission(PERMISSIONS.medicalRepView)
  @ApiPaginatedResponse(MedicalRepListItemDto)
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
  @RequirePermission(PERMISSIONS.medicalRepView)
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

  @Get('medical-reps/:repId/visit-history')
  @ApiPaginatedResponse(MedicalRepVisitHistoryItemDto)
  async repVisitHistory(
    @Param('repId', ParseUUIDPipe) repId: string,
    @Query() query: ListMedicalRepVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitService.listRepVisitHistory(repId, query, user);
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

  @Get('branches/:branchId/medical-rep-visits/my-waiting-list')
  @ApiPaginatedResponse(MedicalRepDto)
  async myWaitingList(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListMedicalRepVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitService.findMyWaitingList(branchId, query, user);
  }

  @Get('branches/:branchId/medical-rep-visits/my-current')
  @ApiStandardArrayResponse(MedicalRepDto)
  async myCurrent(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitService.findMyCurrent(branchId, user);
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

  @Get('medical-rep-visits/:id/history')
  @ApiPaginatedResponse(MedicalRepVisitHistoryItemDto)
  async visitHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMedicalRepVisitsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.visitService.listVisitHistory(id, query, user);
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
