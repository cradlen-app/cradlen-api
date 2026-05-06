import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JourneysService } from './journeys.service';
import { CreateJourneyDto } from './dto/create-journey.dto';
import { UpdateJourneyStatusDto } from './dto/update-journey-status.dto';
import { UpdateEpisodeStatusDto } from './dto/update-episode-status.dto';
import { JourneyDto } from './dto/journey.dto';
import {
  ApiStandardResponse,
  ApiPaginatedResponse,
} from '../../common/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/interfaces/auth-context.interface';

@ApiTags('Journeys')
@Controller()
export class JourneysController {
  constructor(private readonly journeysService: JourneysService) {}

  @Post('patients/:patientId/journeys')
  @ApiStandardResponse(JourneyDto)
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreateJourneyDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.journeysService.create(patientId, dto, user);
  }

  @Get('patients/:patientId/journeys')
  @ApiPaginatedResponse(JourneyDto)
  findAllForPatient(
    @Param('patientId') patientId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.journeysService.findAllForPatient(patientId, user);
  }

  @Get('journeys/:id')
  @ApiStandardResponse(JourneyDto)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return this.journeysService.findOne(id, user);
  }

  @Patch('journeys/:id/status')
  @ApiStandardResponse(JourneyDto)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateJourneyStatusDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.journeysService.updateStatus(id, dto, user);
  }

  @Patch('journeys/:id/episodes/:episodeId/status')
  @ApiStandardResponse(JourneyDto)
  updateEpisodeStatus(
    @Param('id') id: string,
    @Param('episodeId') episodeId: string,
    @Body() dto: UpdateEpisodeStatusDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.journeysService.updateEpisodeStatus(id, episodeId, dto, user);
  }
}
