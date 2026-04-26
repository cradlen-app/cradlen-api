import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProfileRoleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class ProfileOrganizationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [String] })
  specialities!: string[];

  @ApiProperty()
  status!: string;
}

export class ProfileBranchDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  address!: string;

  @ApiProperty()
  city!: string;

  @ApiProperty()
  governorate!: string;

  @ApiProperty()
  is_main!: boolean;
}

export class StaffProfileDto {
  @ApiProperty()
  staff_id!: string;

  @ApiPropertyOptional({ nullable: true })
  job_title!: string | null;

  @ApiProperty({ type: ProfileRoleDto })
  role!: ProfileRoleDto;

  @ApiProperty({ type: ProfileOrganizationDto })
  organization!: ProfileOrganizationDto;

  @ApiProperty({ type: ProfileBranchDto })
  branch!: ProfileBranchDto;
}

export class MeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  first_name!: string;

  @ApiProperty()
  last_name!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  is_active!: boolean;

  @ApiPropertyOptional({ nullable: true })
  verified_at!: Date | null;

  @ApiProperty()
  created_at!: Date;

  @ApiProperty({ type: [StaffProfileDto] })
  profiles!: StaffProfileDto[];
}
