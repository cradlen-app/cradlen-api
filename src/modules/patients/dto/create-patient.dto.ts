import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
} from 'class-validator';

export class CreatePatientDto {
  @IsString() @IsNotEmpty() full_name: string;
  @IsString() @IsOptional() husband_name?: string;
  @IsDateString() date_of_birth: string;
  @IsString() @IsNotEmpty() national_id: string;
  @IsString() @IsNotEmpty() phone_number: string;
  @IsString() @IsNotEmpty() address: string;
}
