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
import { InvestigationsService } from './investigations.service';
import {
  CreateInvestigationsDto,
  InvestigationDto,
  ListInvestigationsQueryDto,
  UpdateInvestigationDto,
} from './dto/investigation.dto';
import { ApiPaginatedResponse, ApiStandardResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

@ApiTags('Clinical')
@Controller()
export class InvestigationsController {
  constructor(private readonly investigationsService: InvestigationsService) {}

  @Get('visits/:id/investigations')
  @ApiStandardResponse(InvestigationDto)
  listForVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.investigationsService.listForVisit(id, user);
  }

  @Post('visits/:id/investigations')
  @ApiStandardResponse(InvestigationDto)
  createMany(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInvestigationsDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.investigationsService.createMany(id, dto, user);
  }

  @Patch('investigations/:id')
  @ApiStandardResponse(InvestigationDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvestigationDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.investigationsService.update(id, dto, user);
  }

  @Patch('investigations/:id/review')
  @ApiStandardResponse(InvestigationDto)
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.investigationsService.review(id, user);
  }

  @Get('patients/:patientId/investigations')
  @ApiPaginatedResponse(InvestigationDto)
  listForPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: ListInvestigationsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.investigationsService.listForPatient(patientId, query, user);
  }
}
