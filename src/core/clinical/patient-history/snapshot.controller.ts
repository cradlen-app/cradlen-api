import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SnapshotService } from './snapshot.service';
import {
  FamilyHistoryDto,
  FertilityHistoryDto,
  GynecologicProceduresDto,
  GynecologicalBaselineDto,
  MedicalChronicIllnessesDto,
  PatientHistoryBundleDto,
  ScreeningHistoryDto,
  SocialHistoryDto,
} from './dto/snapshot.dto';
import { ApiStandardResponse } from '@common/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AuthContext } from '@common/interfaces/auth-context.interface';

@ApiTags('Patient History')
@Controller('patients/:id/history')
export class SnapshotController {
  constructor(private readonly snapshotService: SnapshotService) {}

  @Get()
  @ApiStandardResponse(PatientHistoryBundleDto)
  getBundle(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.snapshotService.getBundle(id, user);
  }

  @Put('gynecological-baseline')
  putGynecologicalBaseline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GynecologicalBaselineDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.snapshotService.putSnapshot(
      id,
      'gynecological_baseline',
      dto,
      user,
    );
  }

  @Put('gynecologic-procedures')
  putGynecologicProcedures(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GynecologicProceduresDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.snapshotService.putSnapshot(
      id,
      'gynecologic_procedures',
      dto,
      user,
    );
  }

  @Put('screening')
  putScreening(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScreeningHistoryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.snapshotService.putSnapshot(id, 'screening_history', dto, user);
  }

  @Put('medical-chronic-illnesses')
  putMedicalChronicIllnesses(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MedicalChronicIllnessesDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.snapshotService.putSnapshot(
      id,
      'medical_chronic_illnesses',
      dto,
      user,
    );
  }

  @Put('family-history')
  putFamilyHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FamilyHistoryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.snapshotService.putSnapshot(id, 'family_history', dto, user);
  }

  @Put('fertility-history')
  putFertilityHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FertilityHistoryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.snapshotService.putSnapshot(id, 'fertility_history', dto, user);
  }

  @Put('social-history')
  putSocialHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SocialHistoryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.snapshotService.putSnapshot(id, 'social_history', dto, user);
  }
}
