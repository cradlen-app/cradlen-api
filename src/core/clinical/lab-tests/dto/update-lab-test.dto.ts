import { LabTestCategory } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateLabTestDto {
  @IsString() @IsOptional() @MinLength(1) @MaxLength(200) name?: string;
  @IsEnum(LabTestCategory) @IsOptional() category?: LabTestCategory;
  @IsUUID() @IsOptional() specialty_id?: string;
}
