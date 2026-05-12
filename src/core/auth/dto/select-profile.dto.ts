import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class SelectProfileDto {
  @ApiProperty()
  @IsString()
  selection_token!: string;

  @ApiProperty()
  @IsUUID()
  profile_id!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branch_id?: string;
}
