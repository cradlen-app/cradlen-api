import {
  IsString,
  IsOptional,
  IsDateString,
  IsEnum,
  Matches,
} from 'class-validator';
import { MaritalStatus } from '@prisma/client';

export class UpdatePatientDto {
  @IsString() @IsOptional() full_name?: string;
  @IsDateString() @IsOptional() date_of_birth?: string;
  @IsString() @IsOptional() phone_number?: string;
  @IsString() @IsOptional() address?: string;
  @IsEnum(MaritalStatus) @IsOptional() marital_status?: MaritalStatus;
  // Identity-key correction (e.g. a typo at registration). Same digits/length
  // rule the book_visit template enforces. Restricted to org managers in the
  // service; uniqueness is enforced by the DB (@unique → 409 on collision).
  @Matches(/^[0-9]{8,20}$/) @IsOptional() national_id?: string;
}
