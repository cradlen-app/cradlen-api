import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CloseCashSessionDto {
  @ApiProperty({ description: 'Physically counted cash at close.' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  counted_amount!: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}
