import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ProceduresLookupQueryDto {
  @IsOptional()
  @IsUUID()
  specialty_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class ProcedureSpecialtyDto {
  id!: string;
  code!: string;
  name!: string;
}

export class ProcedureLookupDto {
  id!: string;
  code!: string;
  name!: string;
  specialty!: ProcedureSpecialtyDto;
}
