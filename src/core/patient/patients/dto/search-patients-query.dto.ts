import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query for the GLOBAL patient lookup (`GET /patients/search`) used by the
 * book-visit autocomplete. Unlike the org-scoped roster (`GET /patients`), this
 * resolves a patient across organizations so a clinic can find someone first
 * registered elsewhere. It matches an EXACT national id or phone number only
 * (never a fuzzy/name search) and returns a minimal projection, so it cannot be
 * used to enumerate or harvest the cross-tenant patient population. `search` is
 * required (min 6 chars) — the caller must already know the identifier.
 */
export class SearchPatientsQueryDto {
  @IsString() @MinLength(6) search!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit?: number =
    20;
}
