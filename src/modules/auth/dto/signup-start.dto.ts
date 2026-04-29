import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MinLength,
} from 'class-validator';

export class SignupStartDto {
  @ApiProperty()
  @IsString()
  first_name!: string;

  @ApiProperty()
  @IsString()
  last_name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPhoneNumber()
  phone_number?: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password!: string;
}
