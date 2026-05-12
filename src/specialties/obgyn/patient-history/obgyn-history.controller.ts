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
import { ObgynHistoryService } from './obgyn-history.service';
import {
  FamilyHistoryDto,
  FertilityHistoryDto,
  GynecologicProceduresDto,
  GynecologicalBaselineDto,
  HusbandNameDto,
  MedicalChronicIllnessesDto,
  PatientObgynHistoryDto,
  ScreeningHistoryDto,
  SocialHistoryDto,
} from './dto/obgyn-history.dto';

const IF_MATCH = {
  name: 'If-Match',
  required: true,
  description:
    'Optimistic concurrency token. Echo the row\'s current `version` as `"version:N"`. The server returns 412 STALE_VERSION on mismatch.',
};

@ApiTags('OB/GYN — Patient History')
@Controller('patients/:id/obgyn-history')
export class ObgynHistoryController {
  constructor(private readonly service: ObgynHistoryService) {}

  @Get()
  @ApiStandardResponse(PatientObgynHistoryDto)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.get(id, user);
  }

  @Patch('menstrual-baseline')
  @ApiHeader(IF_MATCH)
  patchMenstrualBaseline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GynecologicalBaselineDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(
      id,
      'gynecological_baseline',
      dto,
      version,
      user,
    );
  }

  @Patch('gynecologic-procedures')
  @ApiHeader(IF_MATCH)
  patchGynecologicProcedures(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GynecologicProceduresDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(
      id,
      'gynecologic_procedures',
      dto,
      version,
      user,
    );
  }

  @Patch('screening')
  @ApiHeader(IF_MATCH)
  patchScreening(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScreeningHistoryDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(
      id,
      'screening_history',
      dto,
      version,
      user,
    );
  }

  @Patch('medical-chronic-illnesses')
  @ApiHeader(IF_MATCH)
  patchMedicalChronicIllnesses(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MedicalChronicIllnessesDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(
      id,
      'medical_chronic_illnesses',
      dto,
      version,
      user,
    );
  }

  @Patch('family-history')
  @ApiHeader(IF_MATCH)
  patchFamilyHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FamilyHistoryDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(id, 'family_history', dto, version, user);
  }

  @Patch('fertility-history')
  @ApiHeader(IF_MATCH)
  patchFertilityHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FertilityHistoryDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(
      id,
      'fertility_history',
      dto,
      version,
      user,
    );
  }

  @Patch('social-history')
  @ApiHeader(IF_MATCH)
  patchSocialHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SocialHistoryDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchSection(id, 'social_history', dto, version, user);
  }

  @Patch('husband-name')
  @ApiHeader(IF_MATCH)
  patchHusbandName(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HusbandNameDto,
    @IfMatchVersion() version: number,
    @CurrentUser() user: AuthContext,
  ) {
    return this.service.patchHusbandName(id, dto.husband_name, version, user);
  }
}
