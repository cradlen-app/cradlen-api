import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CheckConflictsDto {
  @IsDateString() starts_at!: string;
  @IsDateString() ends_at!: string;
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  participant_profile_ids!: string[];
  @IsUUID() @IsOptional() exclude_event_id?: string;
}
