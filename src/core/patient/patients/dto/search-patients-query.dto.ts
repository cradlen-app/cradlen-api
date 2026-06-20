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
 * Query for the GLOBAL patient lookup (`GET /patients/search`) behind the
 * book-visit autocomplete. `Patient` is a global master index by design, so the
 * service fuzzy-matches by name / national id / phone across all organizations
 * and returns full identity to prefill the booking form (caller's own patients
 * rank first). See {@link PatientsService.searchGlobal}. Min 2 chars avoids
 * firing on a single keystroke; results are capped per page.
 */
export class SearchPatientsQueryDto {
  @IsString() @MinLength(2) search!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit?: number =
    20;
}
