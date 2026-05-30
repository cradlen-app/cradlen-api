import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const META_SHORT = 256;

export class ChiefComplaintMetaDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  @IsOptional()
  categories?: string[];
  @IsString() @IsOptional() @MaxLength(META_SHORT) onset?: string;
  @IsString() @IsOptional() @MaxLength(META_SHORT) duration?: string;
  @IsString() @IsOptional() @MaxLength(META_SHORT) severity?: string;
}
