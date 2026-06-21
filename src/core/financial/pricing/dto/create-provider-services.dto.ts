import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateProviderServicesDto {
  @ApiProperty({
    isArray: true,
    type: String,
    description: 'Service IDs to authorize',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  service_ids!: string[];

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  branch_id?: string;

  @ApiPropertyOptional({
    description: 'Duration in minutes (shared across all)',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  duration_minutes?: number;
}
