import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { ScheduleDayDto } from './invite-staff.dto.js';

export class UpdateScheduleDto {
  @ApiProperty({ type: [ScheduleDayDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days!: ScheduleDayDto[];
}
