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
  @ApiProperty({ type: [WorkingDayResponseDto] })
  days!: WorkingDayResponseDto[];
}

export class InvitationOrganizationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class InvitationUserResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() first_name!: string;
  @ApiProperty() last_name!: string;
  @ApiProperty() email!: string;
}

export class InvitationRoleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class InvitationBranchResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() address!: string;
  @ApiProperty() city!: string;
  @ApiProperty() governorate!: string;
  @ApiPropertyOptional() country?: string;
  @ApiProperty() is_main!: boolean;
}

export class StaffInvitationBranchResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() branch_id!: string;
  @ApiProperty({ type: InvitationBranchResponseDto })
  branch!: InvitationBranchResponseDto;
  @ApiPropertyOptional({ type: ScheduleResponseDto })
  schedule?: ScheduleResponseDto;
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
  @ApiPropertyOptional({ type: ScheduleResponseDto })
  schedule?: ScheduleResponseDto;
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
  @ApiPropertyOptional({ type: InvitationOrganizationResponseDto })
  organization?: InvitationOrganizationResponseDto;
  @ApiPropertyOptional({ type: InvitationUserResponseDto })
  invited_by?: InvitationUserResponseDto;
  @ApiPropertyOptional({ type: InvitationRoleResponseDto })
  role?: InvitationRoleResponseDto;
  @ApiPropertyOptional({ type: [StaffInvitationBranchResponseDto] })
  branches?: StaffInvitationBranchResponseDto[];
}

export class AcceptInvitationResponseDto {
  @ApiProperty({ enum: ['tokens'] }) type!: 'tokens';
  @ApiProperty() access_token!: string;
  @ApiProperty() refresh_token!: string;
  @ApiProperty({ example: 'Bearer' }) token_type!: string;
  @ApiProperty({ example: 900 }) expires_in!: number;
}
