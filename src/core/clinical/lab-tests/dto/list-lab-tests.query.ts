import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { LabTestCategory } from '@prisma/client';

export class ListLabTestsQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsEnum(LabTestCategory) category?: LabTestCategory;
}
