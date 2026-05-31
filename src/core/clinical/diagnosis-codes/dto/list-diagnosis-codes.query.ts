import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListDiagnosisCodesQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsString() @MaxLength(50) specialty_code?: string;
}
