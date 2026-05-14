import { CalendarEventType, CalendarVisibility } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CalendarEventResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() profile_id!: string;
  @ApiProperty() organization_id!: string;
  @ApiPropertyOptional({ nullable: true }) branch_id!: string | null;

  @ApiProperty({ enum: CalendarEventType }) event_type!: CalendarEventType;
  @ApiProperty({ enum: CalendarVisibility }) visibility!: CalendarVisibility;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;

  @ApiProperty() start_at!: Date;
  @ApiProperty() end_at!: Date;
  @ApiProperty() all_day!: boolean;

  @ApiPropertyOptional({ nullable: true }) procedure_id!: string | null;
  @ApiPropertyOptional({ nullable: true }) patient_id!: string | null;

  @ApiPropertyOptional({ nullable: true }) procedure_name?: string | null;
  @ApiPropertyOptional({ nullable: true }) patient_full_name?: string | null;

  @ApiProperty() created_at!: Date;
  @ApiProperty() updated_at!: Date;
}
