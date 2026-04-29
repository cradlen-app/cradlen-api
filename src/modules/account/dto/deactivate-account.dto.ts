import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class DeactivateAccountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
