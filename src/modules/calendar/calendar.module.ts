import { Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';
import { CalendarConflictsService } from './calendar-conflicts.service.js';

@Module({
  controllers: [CalendarController],
  providers: [CalendarService, CalendarConflictsService],
})
export class CalendarModule {}
