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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CalendarService } from './calendar.service.js';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto.js';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto.js';
import { ListCalendarEventsQueryDto } from './dto/list-calendar-events.query.js';
import { CheckConflictsDto } from './dto/check-conflicts.dto.js';
import { StaffSuggestionsQueryDto } from './dto/staff-suggestions.query.js';
import {
  CalendarEventDto,
  CalendarEventWithConflictsDto,
} from './dto/calendar-event.dto.js';
import {
  ApiStandardResponse,
  ApiVoidResponse,
} from '../../common/swagger/index.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuthContext } from '../../common/interfaces/auth-context.interface.js';

@ApiTags('Calendar')
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Post('events')
  @ApiStandardResponse(CalendarEventWithConflictsDto)
  create(
    @Body() dto: CreateCalendarEventDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.calendarService.create(dto, user);
  }

  @Get('events')
  @ApiOperation({
    summary:
      'List calendar events in a window. Required: from, to (ISO datetime).',
  })
  @ApiStandardResponse(CalendarEventDto)
  findAll(
    @Query() query: ListCalendarEventsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.calendarService.findAll(query, user);
  }

  @Post('events/check-conflicts')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Pre-flight conflict check before creating an event',
  })
  findConflicts(
    @Body() dto: CheckConflictsDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.calendarService.checkConflicts(dto, user);
  }

  @Get('staff')
  @ApiOperation({
    summary:
      'List candidate staff for a calendar slot. Filters by job_function code + branch + time window. Includes ON_DEMAND profiles. Marks each candidate with has_conflict.',
  })
  findAvailableStaff(
    @Query() query: StaffSuggestionsQueryDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.calendarService.findAvailableStaff(query, user);
  }

  @Get('events/:id')
  @ApiStandardResponse(CalendarEventDto)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.calendarService.findOne(id, user);
  }

  @Patch('events/:id')
  @ApiStandardResponse(CalendarEventWithConflictsDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCalendarEventDto,
    @CurrentUser() user: AuthContext,
  ) {
    return this.calendarService.update(id, dto, user);
  }

  @Post('events/:id/cancel')
  @HttpCode(200)
  @ApiStandardResponse(CalendarEventDto)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    return this.calendarService.cancel(id, user);
  }

  @Delete('events/:id')
  @HttpCode(204)
  @ApiVoidResponse()
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthContext,
  ) {
    await this.calendarService.remove(id, user);
  }
}
