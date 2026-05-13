import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MedicalRepVisitStatus } from '@prisma/client';

export class UpdateMedicalRepVisitStatusDto {
  @IsEnum(MedicalRepVisitStatus) status!: MedicalRepVisitStatus;
  @IsString() @IsOptional() @MaxLength(500) reason?: string;
}
