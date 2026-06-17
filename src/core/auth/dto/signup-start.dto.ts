import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MatchesField } from '@common/validators/matches-field.validator.js';
import { IsStrongPassword } from '@common/validators/strong-password.validator.js';

export class SignupStartDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  first_name!: string;

  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  last_name!: string;

  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsEmail()
  email!: string;

  @ApiPropertyOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsPhoneNumber()
  phone_number?: string;

  @ApiPropertyOptional({ example: '1990-05-20', description: 'Date of birth (ISO)' })
  @IsOptional()
  @IsDateString()
  date_of_birth?: string;

  @ApiProperty({ example: 'Password1!' })
  @IsStrongPassword()
  password!: string;

  @ApiProperty({ example: 'Password1!' })
  @IsString()
  @MaxLength(128)
  @MatchesField('password')
  confirm_password!: string;
}
