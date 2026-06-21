import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ListGuardiansQueryDto {
  // Optional: omit for the org roster; when provided it drives the GLOBAL
  // cross-org lookup, so require >= 2 chars (mirrors the patient lookup).
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number =
    20;
}
