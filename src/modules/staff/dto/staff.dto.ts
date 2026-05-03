import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateStaffDto {
  @ApiProperty()
  @IsString()
  first_name!: string;

  @ApiProperty()
  @IsString()
  last_name!: string;

  @ApiProperty({ description: 'Phone number — used for OTP login' })
  @IsString()
  phone_number!: string;

  @ApiProperty({ description: 'Min 8 chars. Admin shares this with the staff member.' })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  job_title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialty?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  is_clinical?: boolean;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  role_ids!: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  branch_ids!: string[];
}
