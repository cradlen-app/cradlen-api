import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PatientNotificationDto {
  @ApiProperty() id!: string;
  @ApiProperty() category!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiPropertyOptional({ nullable: true }) navigate_to!: string | null;
  @ApiProperty() is_read!: boolean;
  @ApiPropertyOptional({ nullable: true }) read_at!: Date | null;
  @ApiPropertyOptional({ nullable: true }) metadata!: unknown;
  @ApiProperty() created_at!: Date;
}

export class ListPatientNotificationsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description: 'Filter by category, e.g. medicine | report',
  })
  @IsOptional()
  @IsString()
  category?: string;
}
