import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateContraceptiveDto {
  @IsString() @MaxLength(200) method!: string;
  @IsString() @IsOptional() @MaxLength(200) duration?: string;
  @IsString() @IsOptional() @MaxLength(2000) complications?: string;
  @IsString() @IsOptional() @MaxLength(2000) notes?: string;
}

export class UpdateContraceptiveDto {
  @IsString() @IsOptional() @MaxLength(200) method?: string;
  @IsString() @IsOptional() @MaxLength(200) duration?: string;
  @IsString() @IsOptional() @MaxLength(2000) complications?: string;
  @IsString() @IsOptional() @MaxLength(2000) notes?: string;
}

export class ContraceptiveDto {
  id!: string;
  patient_id!: string;
  method!: string;
  duration!: string | null;
  complications!: string | null;
  notes!: string | null;
  created_by_id!: string | null;
  created_at!: Date;
  updated_at!: Date;
}
