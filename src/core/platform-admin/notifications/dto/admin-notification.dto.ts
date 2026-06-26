import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { AdminNotificationType } from '@prisma/client';
import { AdminListQueryDto } from '../../read/dto/admin-list-query.dto.js';

export class AdminNotificationDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: AdminNotificationType }) type!: AdminNotificationType;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiPropertyOptional({ nullable: true }) organization_id!: string | null;
  @ApiPropertyOptional({ nullable: true }) related_id!: string | null;
  @ApiProperty() is_read!: boolean;
  @ApiProperty() created_at!: Date;
}

export class AdminNotificationsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ description: 'When true, only unread notifications.' })
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  unread?: boolean;
}
