import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateJoinCodeDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  first_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  job_title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialty?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_clinical?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Min(1)
  max_uses?: number;
}

export class AcceptJoinCodeDto {
  @ApiProperty()
  @IsString()
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsPhoneNumber()
  phone_number?: string;

  @ApiProperty()
  @IsString()
  first_name!: string;

  @ApiProperty()
  @IsString()
  last_name!: string;

  @ApiProperty()
  @IsString()
  password!: string;
}
