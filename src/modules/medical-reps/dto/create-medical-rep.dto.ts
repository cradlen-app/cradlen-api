import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateMedicalRepDto {
  @IsString() @IsNotEmpty() @MaxLength(200) full_name!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) company!: string;
  @IsString() @IsOptional() @MaxLength(50) phone?: string;
  @IsEmail() @IsOptional() email?: string;
  @IsString() @IsOptional() @MaxLength(100) territory?: string;
  @IsString() @IsOptional() notes?: string;
}
