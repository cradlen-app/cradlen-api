import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class OpenCashSessionDto {
  @ApiProperty()
  @IsUUID('4')
  branch_id!: string;

  @ApiPropertyOptional({
    description: 'Starting cash in the drawer.',
    default: 0,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  opening_float?: number;
}
