import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class SelectProfileDto {
  @ApiProperty()
  @IsString()
  selection_token!: string;

  @ApiProperty()
  @IsUUID()
  profile_id!: string;
}
