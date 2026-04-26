import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DayOfWeek, InvitationStatus } from '@prisma/client';

export class ShiftResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() start_time!: string;
  @ApiProperty() end_time!: string;
}

export class WorkingDayResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: DayOfWeek }) day_of_week!: DayOfWeek;
  @ApiProperty({ type: [ShiftResponseDto] }) shifts!: ShiftResponseDto[];
}

export class ScheduleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: [WorkingDayResponseDto] }) days!: WorkingDayResponseDto[];
}

export class StaffResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() user_id!: string;
  @ApiProperty() organization_id!: string;
  @ApiProperty() branch_id!: string;
  @ApiProperty() role_id!: string;
  @ApiPropertyOptional() job_title?: string;
  @ApiPropertyOptional() specialty?: string;
  @ApiProperty() created_at!: Date;
  @ApiPropertyOptional({ type: ScheduleResponseDto }) schedule?: ScheduleResponseDto;
}

export class StaffInvitationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() first_name!: string;
  @ApiProperty() last_name!: string;
  @ApiPropertyOptional() phone?: string;
  @ApiProperty() job_title!: string;
  @ApiPropertyOptional() specialty?: string;
  @ApiProperty({ enum: InvitationStatus }) status!: InvitationStatus;
  @ApiProperty() expires_at!: Date;
  @ApiPropertyOptional() accepted_at?: Date;
  @ApiProperty() created_at!: Date;
  @ApiProperty() user_exists!: boolean;
}

export class AcceptInvitationResponseDto {
  @ApiProperty() access_token!: string;
  @ApiProperty() refresh_token!: string;
}
