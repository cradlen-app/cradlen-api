import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VisitPriority } from '@prisma/client';
import { CreateMedicalRepDto } from '../../medical-reps/dto/create-medical-rep.dto';

export class BookRepVisitDto {
  @IsUUID() @IsOptional() medical_rep_id?: string;

  @ValidateNested()
  @Type(() => CreateMedicalRepDto)
  @IsOptional()
  new_medical_rep?: CreateMedicalRepDto;

  @IsUUID() assigned_doctor_id!: string;
  @IsUUID() @IsOptional() branch_id?: string;
  @IsEnum(VisitPriority) priority!: VisitPriority;
  @IsDateString() scheduled_at!: string;

  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(2000) notes?: string;
}
