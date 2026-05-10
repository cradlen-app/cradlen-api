import { LabTestCategory } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateLabTestDto {
  @IsString() @MinLength(1) @MaxLength(64) code!: string;
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsEnum(LabTestCategory) category!: LabTestCategory;
  @IsUUID() @IsOptional() specialty_id?: string;
}
