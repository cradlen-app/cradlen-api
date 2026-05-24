import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateProviderServiceDto {
  @ApiProperty()
  @IsUUID()
  service_id!: string;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  branch_id?: string;

  @ApiPropertyOptional({ description: 'Duration in minutes' })
  @IsInt()
  @Min(1)
  @IsOptional()
  duration_minutes?: number;
}
