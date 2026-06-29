import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, LocksOnClosedVisit } from '@common/decorators';
import { AuthContext } from '@common/interfaces/auth-context.interface';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { EncounterMutationGuard } from '@core/clinical/visits/visits.public';
import { JourneyClinicalHandler } from './journey-clinical.handler';
import { JourneyClinicalRegistry } from './journey-clinical.registry';

/**
 * Generic journey clinical-surface endpoint. One route serves every surface
 * (pregnancy, surgical, …): it resolves the journey's care path and delegates
 * GET/PATCH to the registered handler. PATCH is last-write-wins (no If-Match) —
 * the handler bumps its own version token; closed visits are blocked by
 * `EncounterMutationGuard` (post-close edits go via amendments). The FE calls
 * this single path regardless of surface.
 */
@ApiTags('OB/GYN — Journey Clinical Surface')
@Controller('visits/:visitId/journeys/:journeyId/clinical')
@UseGuards(EncounterMutationGuard)
export class JourneyClinicalController {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly registry: JourneyClinicalRegistry,
  ) {}

  @Get()
  async get(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Param('journeyId', ParseUUIDPipe) journeyId: string,
    @CurrentUser() user: AuthContext,
  ) {
    return (await this.resolveHandler(journeyId)).get(visitId, journeyId, user);
  }

  @Patch()
  @LocksOnClosedVisit('visitId')
  async patch(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Param('journeyId', ParseUUIDPipe) journeyId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthContext,
  ) {
    return (await this.resolveHandler(journeyId)).patch(
      visitId,
      journeyId,
      body,
      user,
    );
  }

  private async resolveHandler(
    journeyId: string,
  ): Promise<JourneyClinicalHandler> {
    const journey = await this.prismaService.db.patientJourney.findFirst({
      where: { id: journeyId, is_deleted: false },
      select: { care_path: { select: { code: true } } },
    });
    if (!journey) {
      throw new NotFoundException(`Journey ${journeyId} not found`);
    }
    return this.registry.resolve(journey.care_path?.code ?? null);
  }
}
