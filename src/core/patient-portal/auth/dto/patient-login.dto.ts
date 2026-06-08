import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MinLength } from 'class-validator';
import {
  NATIONAL_ID_MESSAGE,
  NATIONAL_ID_REGEX,
} from './national-id.constant.js';

export class PatientLoginDto {
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

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;
}
