import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  OrganizationStatus,
  SubscriptionStatus,
  SubscriptionPaymentStatus,
} from '@prisma/client';

/** Shared page/limit/search query for every admin list endpoint. */
export class AdminListQueryDto {
  @ApiPropertyOptional({ description: 'Free-text filter (entity-specific).' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}

export class AdminOrganizationsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: OrganizationStatus })
  @IsEnum(OrganizationStatus)
  @IsOptional()
  status?: OrganizationStatus;

  @ApiPropertyOptional({
    enum: SubscriptionStatus,
    description: "Filter by the org's current subscription status.",
  })
  @IsEnum(SubscriptionStatus)
  @IsOptional()
  subscription_status?: SubscriptionStatus;
}

export class AdminSubscriptionsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: SubscriptionStatus })
  @IsEnum(SubscriptionStatus)
  @IsOptional()
  status?: SubscriptionStatus;
}

export class AdminPaymentsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: SubscriptionPaymentStatus })
  @IsEnum(SubscriptionPaymentStatus)
  @IsOptional()
  status?: SubscriptionPaymentStatus;
}
