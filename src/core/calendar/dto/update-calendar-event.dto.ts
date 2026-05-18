import { PartialType } from '@nestjs/swagger';
import { CreateCalendarEventDto } from './create-calendar-event.dto.js';

export class UpdateCalendarEventDto extends PartialType(
  CreateCalendarEventDto,
) {}
