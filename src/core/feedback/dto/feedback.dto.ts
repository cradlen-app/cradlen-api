import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { FeedbackCategory, FeedbackStatus } from '@prisma/client';

export class CreateFeedbackDto {
  @ApiProperty({ enum: FeedbackCategory })
  @IsEnum(FeedbackCategory)
  category!: FeedbackCategory;

  @ApiProperty({
    example: 'It would help to filter visits by doctor on the calendar.',
    minLength: 3,
    maxLength: 2000,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  message!: string;

  @ApiPropertyOptional({
    description:
      'Whether the submitter agrees to be credited publicly if shipped.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  credit_consent?: boolean;

  @ApiPropertyOptional({ description: 'Path the user was on when submitting.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  page_url?: string;

  @ApiPropertyOptional({ description: 'App version the user was running.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  app_version?: string;

  @ApiPropertyOptional({ description: 'UI locale at submission time.' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;
}

export class FeedbackResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: FeedbackCategory })
  category!: FeedbackCategory;

  @ApiProperty({ enum: FeedbackStatus })
  status!: FeedbackStatus;

  @ApiProperty()
  created_at!: Date;
}
