import { ApiProperty } from '@nestjs/swagger';

/** Lifecycle of a platform-admin account (derived; never exposes the hash). */
export type AdminAccountStatus = 'ACTIVE' | 'PENDING' | 'DISABLED';

export class AdminResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() full_name!: string;
  @ApiProperty({
    enum: ['ACTIVE', 'PENDING', 'DISABLED'],
    description:
      'ACTIVE = password set & enabled; PENDING = invited, awaiting set-password; DISABLED = deactivated.',
  })
  status!: AdminAccountStatus;
  @ApiProperty() created_at!: Date;
}
