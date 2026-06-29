import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import type { AuthContext } from '@common/interfaces/auth-context.interface.js';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
} from '@common/swagger/index.js';
import {
  InvestigationAttachmentsItemDto,
  InvestigationReviewDto,
  ReviewInvestigationDto,
} from './dto/investigation-review.dto.js';
import { ListInvestigationsQueryDto } from './dto/list-investigations.query.dto.js';
import { InvestigationsService } from './investigations.service.js';

@ApiTags('Investigations')
@Controller({ path: 'investigations', version: '1' })
export class InvestigationsController {
  constructor(private readonly investigationsService: InvestigationsService) {}

  @Get()
  @ApiOperation({
    summary:
      "List a patient's investigations that have result files (attachments)",
  })
  @ApiPaginatedResponse(InvestigationAttachmentsItemDto)
  list(
    @Query() query: ListInvestigationsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.investigationsService.listForPatient(query, user);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single investigation for doctor review (with result files)',
  })
  @ApiStandardResponse(InvestigationReviewDto)
  getReview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.investigationsService.getReview(id, user);
  }

  @Patch(':id/review')
  @ApiOperation({
    summary: 'Record the doctor review: mark REVIEWED and save notes',
  })
  @ApiStandardResponse(InvestigationReviewDto)
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
    @Body() dto: ReviewInvestigationDto,
  ) {
    return this.investigationsService.review(id, user, dto);
  }
}
