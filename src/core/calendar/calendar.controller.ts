import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
  ApiVoidResponse,
} from '@common/swagger/index.js';
import { CurrentUser } from '@common/decorators/current-user.decorator.js';
import { AuthContext } from '@common/interfaces/auth-context.interface.js';
import { CalendarService } from './calendar.service.js';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto.js';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto.js';
import { ListCalendarEventsQueryDto } from './dto/list-calendar-events.query.dto.js';
import { CalendarEventResponseDto } from './dto/calendar-event.response.dto.js';

@ApiTags('Calendar')
@ApiBearerAuth()
@Controller({ path: 'calendar/events', version: '1' })
export class CalendarController {
  constructor(private readonly service: CalendarService) {}

  @Post()
  @ApiOperation({ summary: 'Create an event on the caller’s calendar' })
  @ApiStandardResponse(CalendarEventResponseDto)
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateCalendarEventDto,
  ) {
    return this.service.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'List calendar events visible to the caller (own + branch-visible org events)',
  })
  @ApiPaginatedResponse(CalendarEventResponseDto)
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListCalendarEventsQueryDto,
  ) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a single calendar event' })
  @ApiStandardResponse(CalendarEventResponseDto)
  findOne(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(user, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an event the caller owns' })
  @ApiStandardResponse(CalendarEventResponseDto)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete an event the caller owns' })
  @ApiVoidResponse()
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.remove(user, id);
  }
}
