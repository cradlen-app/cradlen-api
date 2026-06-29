import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';

export class AdminAuditLogResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() admin_id!: string;
  @ApiProperty() admin_email!: string;
  @ApiProperty({ description: 'e.g. payment.verify, subscription.suspend' })
  action!: string;
  @ApiProperty() target_type!: string;
  @ApiPropertyOptional({ nullable: true }) target_id!: string | null;
  @ApiPropertyOptional({ nullable: true })
  before!: Prisma.JsonValue | null;
  @ApiPropertyOptional({ nullable: true })
  after!: Prisma.JsonValue | null;
  @ApiProperty() created_at!: Date;
}
