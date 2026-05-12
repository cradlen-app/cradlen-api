import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { ApiStandardResponse } from '@common/swagger';
import { CurrentUser, IfMatchVersion } from '@common/decorators';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { ObgynEncounterService } from './obgyn-encounter.service';
import {
  AbdominalFindingsDto,
  BreastFindingsDto,
  CardiovascularFindingsDto,
  ExtremitiesFindingsDto,
  GeneralFindingsDto,
  MenstrualFindingsDto,
  NeurologicalFindingsDto,
  PelvicFindingsDto,
  RespiratoryFindingsDto,
  SkinFindingsDto,
  VisitObgynEncounterDto,
} from './dto/obgyn-encounter.dto';

const IF_MATCH = {
  name: 'If-Match',
  required: true,
  description:
    'Optimistic concurrency token. Echo the row\'s current `version` as `"version:N"`.',
};

@ApiTags('OB/GYN — Visit Encounter')
@Controller('visits/:id/obgyn-encounter')
export class ObgynEncounterController {
  constructor(private readonly service: ObgynEncounterService) {}

  @Get()
  @ApiStandardResponse(VisitObgynEncounterDto)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.get(id, user);
  }

  @Patch('general')
  @ApiHeader(IF_MATCH)
  patchGeneral(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GeneralFindingsDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(
      id,
      'general_findings',
      dto,
      version,
      user,
    );
  }

  @Patch('cardiovascular')
  @ApiHeader(IF_MATCH)
  patchCardiovascular(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CardiovascularFindingsDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(
      id,
      'cardiovascular_findings',
      dto,
      version,
      user,
    );
  }

  @Patch('respiratory')
  @ApiHeader(IF_MATCH)
  patchRespiratory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespiratoryFindingsDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(
      id,
      'respiratory_findings',
      dto,
      version,
      user,
    );
  }

  @Patch('menstrual')
  @ApiHeader(IF_MATCH)
  patchMenstrual(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MenstrualFindingsDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(
      id,
      'menstrual_findings',
      dto,
      version,
      user,
    );
  }

  @Patch('abdominal')
  @ApiHeader(IF_MATCH)
  patchAbdominal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AbdominalFindingsDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(
      id,
      'abdominal_findings',
      dto,
      version,
      user,
    );
  }

  @Patch('pelvic')
  @ApiHeader(IF_MATCH)
  patchPelvic(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PelvicFindingsDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(id, 'pelvic_findings', dto, version, user);
  }

  @Patch('breast')
  @ApiHeader(IF_MATCH)
  patchBreast(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BreastFindingsDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(id, 'breast_findings', dto, version, user);
  }

  @Patch('extremities')
  @ApiHeader(IF_MATCH)
  patchExtremities(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtremitiesFindingsDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(
      id,
      'extremities_findings',
      dto,
      version,
      user,
    );
  }

  @Patch('neurological')
  @ApiHeader(IF_MATCH)
  patchNeurological(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NeurologicalFindingsDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(
      id,
      'neurological_findings',
      dto,
      version,
      user,
    );
  }

  @Patch('skin')
  @ApiHeader(IF_MATCH)
  patchSkin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SkinFindingsDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(id, 'skin_findings', dto, version, user);
  }
}
