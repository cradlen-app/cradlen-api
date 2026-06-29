import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class RejectPaymentDto {
  @ApiProperty({ description: 'Why the payment was rejected (min 4 chars).' })
  @IsString()
  @MinLength(4)
  reason!: string;
}

export class ReasonDto {
  @ApiPropertyOptional({
    description: 'Optional note recorded in the audit log.',
  })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class ExtendSubscriptionDto {
  @ApiProperty({ description: 'Days to extend the subscription end date by.' })
  @IsInt()
  @Min(1)
  @Max(3650)
  days!: number;
}

export class ChangePlanDto {
  @ApiProperty({
    description: 'Target plan code (e.g. individual, center, network).',
  })
  @IsString()
  @MinLength(1)
  plan!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'New password for the user (min 8 chars).' })
  @IsString()
  @MinLength(8)
  new_password!: string;
}
