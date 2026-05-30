import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListMedicalRepVisitsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number =
    20;
  @IsOptional() @IsUUID() branch_id?: string;
}
