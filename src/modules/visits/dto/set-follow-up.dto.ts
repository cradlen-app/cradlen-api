import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetFollowUpDto {
  @IsDateString() @IsOptional() follow_up_date?: string;
  @IsString() @IsOptional() @MaxLength(2000) follow_up_notes?: string;
}
