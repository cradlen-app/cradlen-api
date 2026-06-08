import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsString, Matches, MinLength } from 'class-validator';
import {
  NATIONAL_ID_MESSAGE,
  NATIONAL_ID_REGEX,
} from './national-id.constant.js';

export class PatientSignupStartDto {
  @ApiProperty({
    example: '29005200101234',
    description: '14-digit national ID',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(NATIONAL_ID_REGEX, { message: NATIONAL_ID_MESSAGE })
  national_id!: string;

  @ApiProperty({ example: '1990-05-20', description: 'Date of birth (ISO)' })
  @IsDateString()
  date_of_birth!: string;

  @ApiProperty({ description: 'Phone number on file with the clinic' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  phone_number!: string;
}
