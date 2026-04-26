import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { DayOfWeek } from '@prisma/client';

export class ShiftDto {
  @ApiProperty({ example: '09:00' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'start_time must be HH:MM' })
  start_time!: string;

  @ApiProperty({ example: '17:00' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'end_time must be HH:MM' })
  end_time!: string;
}

export class ScheduleDayDto {
  @ApiProperty({ enum: DayOfWeek })
  @IsEnum(DayOfWeek)
  day_of_week!: DayOfWeek;

  @ApiProperty({ type: [ShiftDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShiftDto)
  shifts!: ShiftDto[];
}

export class ScheduleDto {
  @ApiProperty({ type: [ScheduleDayDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days!: ScheduleDayDto[];
}

export class BranchScheduleDto {
  @ApiProperty()
  @IsUUID()
  branch_id!: string;

  @ApiProperty({ type: ScheduleDto })
  @ValidateNested()
  @Type(() => ScheduleDto)
  schedule!: ScheduleDto;
}

export class InviteStaffDto {
  @ApiProperty()
  @IsUUID()
  organization_id!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  first_name!: string;

  @ApiProperty()
  @IsString()
  last_name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty()
  @IsUUID()
  role_id!: string;

  @ApiProperty()
  @IsString()
  job_title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialty?: string;

  @ApiProperty({ type: [BranchScheduleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BranchScheduleDto)
  branches!: BranchScheduleDto[];
}
